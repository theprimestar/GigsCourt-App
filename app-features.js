// ========================================
// GigsCourt - Features Module (React Native)
// Home Feed, Search, Chat, Profile, Admin.
// ========================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Image,
    FlatList,
    RefreshControl,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Dimensions,
    Modal,
    Animated,
    Linking
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Paystack } from '@paystack/paystack-react-native';
import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    setDoc,
    updateDoc,
    addDoc,
    orderBy,
    onSnapshot,
    doc,
    deleteDoc,
    limit,
    startAfter,
    writeBatch,
    increment
} from 'firebase/firestore';

// Import from core
import {
    haptic,
    formatRelativeTime,
    getOptimizedImageUrl,
    uploadImage,
    sendPushNotification,
    addNotification,
    PRESET_SERVICES
} from './app-core';

// Import gigs module
import {
    registerGig,
    submitReview,
    cancelGig,
    checkGigStatusAndUpdateUI,
    showReviewBottomSheet,
    showReviews,
    showRecentChatsForGig,
    recalculateStaleCounters
} from './app-gigs';

// ========== GLOBAL VARIABLES ==========
const db = global.db;
const auth = global.auth;
const supabase = global.supabase;

// ========== CACHE HELPERS ==========
const CACHE_PREFIX = 'provider_';
const CACHE_EXPIRY_DAYS = 7;

async function getCachedProvider(userId) {
    try {
        const cached = await AsyncStorage.getItem(`${CACHE_PREFIX}${userId}`);
        if (!cached) return null;
        
        const data = JSON.parse(cached);
        const cacheAge = Date.now() - data.cachedAt;
        const maxAge = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        
        if (cacheAge > maxAge) {
            await AsyncStorage.removeItem(`${CACHE_PREFIX}${userId}`);
            return null;
        }
        
        return data;
    } catch (e) {
        return null;
    }
}

async function setCachedProvider(userId, data) {
    try {
        const cacheData = {
            ...data,
            cachedAt: Date.now()
        };
        await AsyncStorage.setItem(`${CACHE_PREFIX}${userId}`, JSON.stringify(cacheData));
    } catch (e) {
        console.warn('Cache write error:', e);
    }
}

// ========== FORMAT DISTANCE ==========
function formatDistance(meters) {
    if (!meters) return 'Unknown distance';
    if (meters < 1000) return `${Math.round(meters)}m away`;
    return `${(meters / 1000).toFixed(1)}km away`;
}

// ========== BATCH FETCH USERS ==========
async function batchFetchUsersFromFirestore(userIds) {
    if (!userIds || userIds.length === 0) return {};
    
    try {
        const usersMap = {};
        const batchSize = 30;
        
        for (let i = 0; i < userIds.length; i += batchSize) {
            const batch = userIds.slice(i, i + batchSize);
            
            const promises = batch.map(async (userId) => {
                const userRef = doc(db, 'users', userId);
                const userSnap = await getDoc(userRef);
                
                if (userSnap.exists()) {
                    const data = userSnap.data();
                    let gigsLast7Days = data.gigsLast7Days || 0;
                    let gigsLast30Days = data.gigsLast30Days || 0;
                    
                    const hasCompletedGigs = (data.gigCount || 0) > 0;
                    const isActive = hasCompletedGigs && ((gigsLast7Days >= 1) || (gigsLast30Days >= 3));
                    
                    usersMap[userId] = {
                        displayName: data.displayName || 'Anonymous',
                        photoURL: data.photoURL || null,
                        rating: data.rating || 0,
                        reviewCount: data.reviewCount || 0,
                        gigsLast30Days: gigsLast30Days,
                        isActive: isActive,
                        hasCompletedGigs: hasCompletedGigs,
                        services: data.services || []
                    };
                }
            });
            
            await Promise.all(promises);
        }
        
        return usersMap;
    } catch (error) {
        console.error('batchFetchUsersFromFirestore error:', error);
        return {};
    }
}

// ========== GET SINGLE PROFILE ==========
async function getSingleProfileFromFirestore(userId) {
    try {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) return null;
        
        const data = userSnap.data();
        return {
            id: userId,
            displayName: data.displayName || 'Anonymous',
            photoURL: data.photoURL || null,
            bio: data.bio || '',
            phone: data.phone || '',
            addressText: data.addressText || '',
            services: data.services || [],
            portfolio: data.portfolio || [],
            credits: data.credits || 0,
            gigCount: data.gigCount || 0,
            rating: data.rating || 0,
            reviewCount: data.reviewCount || 0
        };
    } catch (error) {
        console.error('getSingleProfileFromFirestore error:', error);
        return null;
    }
}

// Make globally available
global.getSingleProfileFromFirestore = getSingleProfileFromFirestore;
global.batchFetchUsersFromFirestore = batchFetchUsersFromFirestore;
global.formatDistance = formatDistance;

// ========== HOME SCREEN ==========
export function HomeScreen() {
    const navigation = useNavigation();
    const [providers, setProviders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [userLocation, setUserLocation] = useState(null);
    
    const cursorRef = useRef(null);
    const bottomSheetRef = useRef(null);
    const [selectedProvider, setSelectedProvider] = useState(null);
    
    const HOME_FEED_LIMIT = 20;
    
    useEffect(() => {
        getCurrentLocation();
    }, []);
    
    const getCurrentLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({});
                setUserLocation({
                    lat: loc.coords.latitude,
                    lng: loc.coords.longitude
                });
            } else {
                setUserLocation({ lat: 6.5244, lng: 3.3792 }); // Default Lagos
            }
        } catch (error) {
            setUserLocation({ lat: 6.5244, lng: 3.3792 });
        }
    };
    
    useEffect(() => {
        if (userLocation) {
            loadHomeFeed(true);
        }
    }, [userLocation]);
    
    const loadHomeFeed = async (reset = false) => {
        if (!userLocation) return;
        if (loading && !reset) return;
        if (!hasMore && !reset) return;
        
        if (reset) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }
        
        try {
            const cursorDistance = reset ? null : cursorRef.current?.distance;
            const cursorUserId = reset ? null : cursorRef.current?.userId;
            
            const { data: newProviders, error } = await supabase.rpc('get_home_feed_providers', {
                p_current_lat: userLocation.lat,
                p_current_lng: userLocation.lng,
                p_limit: HOME_FEED_LIMIT,
                p_cursor_distance: cursorDistance,
                p_cursor_user_id: cursorUserId
            });
            
            if (error) throw error;
            
            if (newProviders && newProviders.length > 0) {
                const lastProvider = newProviders[newProviders.length - 1];
                cursorRef.current = {
                    distance: lastProvider.distance_meters,
                    userId: lastProvider.user_id
                };
                
                const userIds = newProviders.map(p => p.user_id);
                const firestoreUsers = await batchFetchUsersFromFirestore(userIds);
                
                const enrichedProviders = newProviders.map(p => ({
                    ...p,
                    userData: firestoreUsers[p.user_id] || { isActive: false }
                }));
                
                if (reset) {
                    setProviders(enrichedProviders);
                } else {
                    setProviders(prev => [...prev, ...enrichedProviders]);
                }
                
                setHasMore(newProviders.length === HOME_FEED_LIMIT);
            } else {
                setHasMore(false);
            }
        } catch (error) {
            console.error('loadHomeFeed error:', error);
            global.showToast('Error loading feed', 'error');
        } finally {
            setLoading(false);
            setLoadingMore(false);
            setRefreshing(false);
        }
    };
    
    const handleRefresh = () => {
        setRefreshing(true);
        cursorRef.current = null;
        loadHomeFeed(true);
    };
    
    const handleLoadMore = () => {
        if (hasMore && !loadingMore) {
            loadHomeFeed(false);
        }
    };
    
    const handleProviderPress = (provider) => {
        haptic('light');
        setSelectedProvider(provider);
        bottomSheetRef.current?.expand();
    };
    
    const handleViewFullProfile = () => {
        if (selectedProvider) {
            bottomSheetRef.current?.close();
            global.currentViewedUserId = selectedProvider.user_id;
            navigation.navigate('Profile', { userId: selectedProvider.user_id });
        }
    };
    
    const handleMessageProvider = () => {
        if (selectedProvider) {
            bottomSheetRef.current?.close();
            navigation.navigate('Chat', { userId: selectedProvider.user_id });
        }
    };
    
    const renderProviderCard = ({ item }) => {
        const provider = item;
        const userData = provider.userData || {};
        const servicesList = provider.services ? provider.services.split(',').map(s => s.trim()) : [];
        
        return (
            <TouchableOpacity 
                style={homeStyles.card}
                onPress={() => handleProviderPress(provider)}
                activeOpacity={0.7}
            >
                <View style={homeStyles.cardHeader}>
                    <Image 
                        source={{ 
                            uri: getOptimizedImageUrl(userData.photoURL, 100, 100) || 
                                 `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.displayName || 'User')}` 
                        }}
                        style={homeStyles.avatar}
                    />
                    <View style={homeStyles.cardInfo}>
                        <View style={homeStyles.nameRow}>
                            <Text style={homeStyles.name}>{userData.displayName || 'Anonymous'}</Text>
                            {userData.isActive && (
                                <View style={homeStyles.activeBadge}>
                                    <Text style={homeStyles.activeBadgeText}>Active</Text>
                                </View>
                            )}
                        </View>
                        <View style={homeStyles.ratingRow}>
                            <Text style={homeStyles.star}>★</Text>
                            <Text style={homeStyles.rating}>
                                {(userData.rating || 0).toFixed(1)} ({userData.reviewCount || 0})
                            </Text>
                        </View>
                    </View>
                </View>
                
                <View style={homeStyles.servicesContainer}>
                    {servicesList.slice(0, 3).map((service, index) => (
                        <View key={index} style={homeStyles.serviceTag}>
                            <Text style={homeStyles.serviceText}>{service}</Text>
                        </View>
                    ))}
                </View>
                
                {userData.hasCompletedGigs && (
                    <Text style={homeStyles.monthlyGigs}>
                        {userData.isActive ? '🔥 ' : ''}{userData.gigsLast30Days} gigs this month
                    </Text>
                )}
                
                <Text style={homeStyles.distance}>📍 {formatDistance(provider.distance_meters)}</Text>
            </TouchableOpacity>
        );
    };
    
    const renderFooter = () => {
        if (!loadingMore) return null;
        return (
            <View style={homeStyles.loadingMore}>
                <ActivityIndicator size="small" color="#E67E22" />
            </View>
        );
    };
    
    const renderEmpty = () => {
        if (loading) {
            return (
                <View style={homeStyles.skeletonContainer}>
                    {[1, 2, 3, 4, 5].map(i => (
                        <View key={i} style={homeStyles.skeletonCard}>
                            <View style={homeStyles.skeletonHeader}>
                                <View style={homeStyles.skeletonAvatar} />
                                <View style={homeStyles.skeletonInfo}>
                                    <View style={homeStyles.skeletonLine} />
                                    <View style={[homeStyles.skeletonLine, homeStyles.skeletonShort]} />
                                </View>
                            </View>
                            <View style={homeStyles.skeletonTags}>
                                <View style={homeStyles.skeletonTag} />
                                <View style={homeStyles.skeletonTag} />
                            </View>
                            <View style={[homeStyles.skeletonLine, homeStyles.skeletonShort]} />
                        </View>
                    ))}
                </View>
            );
        }
        
        return (
            <View style={homeStyles.emptyContainer}>
                <Text style={homeStyles.emptyText}>No providers found nearby</Text>
            </View>
        );
    };
    
    return (
        <View style={homeStyles.container}>
            <View style={homeStyles.header}>
                <Text style={homeStyles.logo}>
                    <Text style={homeStyles.logoGigs}>Gigs</Text>
                    <Text style={homeStyles.logoCourt}>Court</Text>
                </Text>
                <TouchableOpacity onPress={() => navigation.navigate('Notifications')}>
                    <Text style={homeStyles.notificationIcon}>🔔</Text>
                </TouchableOpacity>
            </View>
            
            <FlatList
                data={providers}
                renderItem={renderProviderCard}
                keyExtractor={(item, index) => `${item.user_id}-${index}`}
                contentContainerStyle={homeStyles.listContent}
                refreshControl={
                    <RefreshControl 
                        refreshing={refreshing} 
                        onRefresh={handleRefresh}
                        colors={['#E67E22']}
                        tintColor="#E67E22"
                    />
                }
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.3}
                ListFooterComponent={renderFooter}
                ListEmptyComponent={renderEmpty}
                showsVerticalScrollIndicator={false}
            />
            
            <BottomSheet
                ref={bottomSheetRef}
                index={-1}
                snapPoints={['50%']}
                enablePanDownToClose
                backgroundStyle={bottomSheetStyles.background}
            >
                <BottomSheetScrollView contentContainerStyle={bottomSheetStyles.content}>
                    {selectedProvider && (
                        <View style={bottomSheetStyles.container}>
                            <Image 
                                source={{ 
                                    uri: getOptimizedImageUrl(selectedProvider.userData?.photoURL, 160, 160) || 
                                         `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedProvider.userData?.displayName || 'User')}` 
                                }}
                                style={bottomSheetStyles.avatar}
                            />
                            
                            <View style={bottomSheetStyles.nameRow}>
                                <Text style={bottomSheetStyles.name}>
                                    {selectedProvider.userData?.displayName || 'Anonymous'}
                                </Text>
                                {selectedProvider.userData?.isActive && (
                                    <View style={bottomSheetStyles.activeBadge}>
                                        <Text style={bottomSheetStyles.activeBadgeText}>Active</Text>
                                    </View>
                                )}
                            </View>
                            
                            <View style={bottomSheetStyles.ratingRow}>
                                <Text style={bottomSheetStyles.star}>★</Text>
                                <Text style={bottomSheetStyles.rating}>
                                    {(selectedProvider.userData?.rating || 0).toFixed(1)} ({selectedProvider.userData?.reviewCount || 0})
                                </Text>
                            </View>
                            
                            <View style={bottomSheetStyles.servicesContainer}>
                                {(selectedProvider.services ? selectedProvider.services.split(',').map(s => s.trim()) : []).slice(0, 3).map((service, index) => (
                                    <View key={index} style={bottomSheetStyles.serviceTag}>
                                        <Text style={bottomSheetStyles.serviceText}>{service}</Text>
                                    </View>
                                ))}
                            </View>
                            
                            <View style={bottomSheetStyles.buttonRow}>
                                <TouchableOpacity 
                                    style={bottomSheetStyles.primaryButton}
                                    onPress={handleViewFullProfile}
                                >
                                    <Text style={bottomSheetStyles.primaryButtonText}>View Full Profile</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity 
                                    style={bottomSheetStyles.secondaryButton}
                                    onPress={handleMessageProvider}
                                >
                                    <Text style={bottomSheetStyles.secondaryButtonText}>Message</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </BottomSheetScrollView>
            </BottomSheet>
        </View>
    );
}

// ========== HOME STYLES ==========
const homeStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingBottom: 10,
        backgroundColor: '#0f0f0f',
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    logo: {
        fontSize: 24,
        fontWeight: '700',
    },
    logoGigs: {
        color: '#E67E22',
    },
    logoCourt: {
        color: '#f5f5f5',
    },
    notificationIcon: {
        fontSize: 24,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 20,
    },
    card: {
        backgroundColor: '#1a1a1a',
        borderRadius: 20,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        borderWidth: 2,
        borderColor: '#E67E22',
    },
    cardInfo: {
        flex: 1,
        marginLeft: 12,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: '#f5f5f5',
        marginRight: 8,
    },
    activeBadge: {
        backgroundColor: '#4caf50',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 20,
    },
    activeBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '500',
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    star: {
        color: '#ffc107',
        fontSize: 14,
        marginRight: 4,
    },
    rating: {
        fontSize: 13,
        color: '#8e8e8e',
    },
    servicesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 8,
    },
    serviceTag: {
        backgroundColor: '#242424',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 20,
        marginRight: 8,
        marginBottom: 8,
    },
    serviceText: {
        fontSize: 12,
        color: '#f5f5f5',
    },
    monthlyGigs: {
        fontSize: 12,
        color: '#8e8e8e',
        marginBottom: 4,
    },
    distance: {
        fontSize: 12,
        color: '#8e8e8e',
    },
    loadingMore: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    emptyContainer: {
        paddingTop: 60,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#8e8e8e',
    },
    skeletonContainer: {
        paddingTop: 12,
    },
    skeletonCard: {
        backgroundColor: '#1a1a1a',
        borderRadius: 20,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    skeletonHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    skeletonAvatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#2c2c2c',
    },
    skeletonInfo: {
        flex: 1,
        marginLeft: 12,
    },
    skeletonLine: {
        height: 14,
        backgroundColor: '#2c2c2c',
        borderRadius: 4,
        marginBottom: 8,
        width: '100%',
    },
    skeletonShort: {
        width: '60%',
    },
    skeletonTags: {
        flexDirection: 'row',
        marginBottom: 8,
    },
    skeletonTag: {
        width: 70,
        height: 28,
        backgroundColor: '#2c2c2c',
        borderRadius: 20,
        marginRight: 8,
    },
});

const bottomSheetStyles = StyleSheet.create({
    background: {
        backgroundColor: '#1a1a1a',
    },
    content: {
        paddingBottom: 30,
    },
    container: {
        paddingHorizontal: 20,
        paddingTop: 10,
        alignItems: 'center',
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        marginBottom: 12,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginBottom: 8,
    },
    name: {
        fontSize: 20,
        fontWeight: '600',
        color: '#f5f5f5',
        marginRight: 8,
    },
    activeBadge: {
        backgroundColor: '#4caf50',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 20,
    },
    activeBadgeText: {
        color: '#fff',
        fontSize: 10,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    star: {
        color: '#ffc107',
        fontSize: 16,
        marginRight: 4,
    },
    rating: {
        fontSize: 14,
        color: '#8e8e8e',
    },
    servicesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 20,
    },
    serviceTag: {
        backgroundColor: '#242424',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 20,
        marginHorizontal: 4,
        marginBottom: 8,
    },
    serviceText: {
        fontSize: 12,
        color: '#f5f5f5',
    },
    buttonRow: {
        flexDirection: 'row',
        width: '100%',
    },
    primaryButton: {
        flex: 1,
        backgroundColor: '#E67E22',
        borderRadius: 30,
        paddingVertical: 14,
        alignItems: 'center',
        marginRight: 8,
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    secondaryButton: {
        flex: 1,
        backgroundColor: '#242424',
        borderRadius: 30,
        paddingVertical: 14,
        alignItems: 'center',
        marginLeft: 8,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    secondaryButtonText: {
        color: '#f5f5f5',
        fontSize: 16,
        fontWeight: '600',
    },
});

console.log('✅ app-features.js Part 1 loaded');

// ========================================
// SEARCH SCREEN
// ========================================

export function SearchScreen() {
    const navigation = useNavigation();
    const [viewMode, setViewMode] = useState('map'); // 'map' or 'list'
    const [searchQuery, setSearchQuery] = useState('');
    const [radius, setRadius] = useState(5);
    const [userLocation, setUserLocation] = useState(null);
    const [providers, setProviders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [mapRef, setMapRef] = useState(null);
    const [selectedProvider, setSelectedProvider] = useState(null);
    
    const cursorRef = useRef(null);
    const bottomSheetRef = useRef(null);
    const searchTimeoutRef = useRef(null);
    
    const SEARCH_LIMIT = 20;
    
    useEffect(() => {
        getCurrentLocation();
    }, []);
    
    const getCurrentLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({});
                setUserLocation({
                    lat: loc.coords.latitude,
                    lng: loc.coords.longitude
                });
            } else {
                setUserLocation({ lat: 6.5244, lng: 3.3792 });
            }
        } catch (error) {
            setUserLocation({ lat: 6.5244, lng: 3.3792 });
        }
    };
    
    const performSearch = async (reset = false) => {
        if (!userLocation) return;
        if (loading && !reset) return;
        if (!hasMore && !reset) return;
        
        if (reset) {
            setLoading(true);
            cursorRef.current = null;
        } else {
            setLoadingMore(true);
        }
        
        try {
            const cursorDistance = reset ? null : cursorRef.current?.distance;
            const cursorUserId = reset ? null : cursorRef.current?.userId;
            
            const { data: results, error } = await supabase.rpc('search_providers', {
                p_current_lat: userLocation.lat,
                p_current_lng: userLocation.lng,
                p_radius_km: radius,
                p_service_filter: searchQuery || null,
                p_limit: SEARCH_LIMIT,
                p_cursor_distance: cursorDistance,
                p_cursor_user_id: cursorUserId
            });
            
            if (error) throw error;
            
            if (results && results.length > 0) {
                const lastProvider = results[results.length - 1];
                cursorRef.current = {
                    distance: lastProvider.distance_meters,
                    userId: lastProvider.user_id
                };
                
                const filteredResults = results.filter(p => p.user_id !== auth.currentUser?.uid);
                const userIds = filteredResults.map(p => p.user_id);
                const firestoreUsers = await batchFetchUsersFromFirestore(userIds);
                
                const enrichedProviders = filteredResults.map(p => ({
                    ...p,
                    userData: firestoreUsers[p.user_id] || { isActive: false }
                }));
                
                if (reset) {
                    setProviders(enrichedProviders);
                } else {
                    setProviders(prev => [...prev, ...enrichedProviders]);
                }
                
                setHasMore(results.length === SEARCH_LIMIT);
            } else {
                if (reset) setProviders([]);
                setHasMore(false);
            }
        } catch (error) {
            console.error('Search error:', error);
            global.showToast('Error searching', 'error');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };
    
    const handleSearchChange = (text) => {
        setSearchQuery(text);
        
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        
        searchTimeoutRef.current = setTimeout(() => {
            performSearch(true);
        }, 400);
    };
    
    const handleRadiusChange = (value) => {
        setRadius(value);
        performSearch(true);
        
        // Update map zoom
        if (mapRef && userLocation) {
            const zoom = value <= 1 ? 14 : value <= 2 ? 13 : value <= 5 ? 12 : value <= 10 ? 11 : 10;
            mapRef.setCamera({
                centerCoordinate: [userLocation.lng, userLocation.lat],
                zoomLevel: zoom,
                animationDuration: 300
            });
        }
    };
    
    const handleProviderPress = (provider) => {
        haptic('light');
        setSelectedProvider(provider);
        bottomSheetRef.current?.expand();
    };
    
    const handleViewFullProfile = () => {
        if (selectedProvider) {
            bottomSheetRef.current?.close();
            global.currentViewedUserId = selectedProvider.user_id;
            navigation.navigate('Profile', { userId: selectedProvider.user_id });
        }
    };
    
    const handleMessageProvider = () => {
        if (selectedProvider) {
            bottomSheetRef.current?.close();
            navigation.navigate('Chat', { userId: selectedProvider.user_id });
        }
    };
    
    const handleLoadMore = () => {
        if (hasMore && !loadingMore && providers.length > 0) {
            performSearch(false);
        }
    };
    
    const renderMapMarker = (provider) => {
        if (!provider.location_lat || !provider.location_lng) return null;
        
        const isActive = provider.userData?.isActive;
        
        return (
            <MapLibreGL.MarkerView
                key={provider.user_id}
                coordinate={[provider.location_lng, provider.location_lat]}
                anchor={{ x: 0.5, y: 0.5 }}
            >
                <TouchableOpacity onPress={() => handleProviderPress(provider)}>
                    <View style={[
                        searchStyles.marker,
                        { backgroundColor: isActive ? '#E67E22' : '#8e8e8e' }
                    ]}>
                        <Text style={searchStyles.markerText}>
                            {provider.userData?.displayName?.charAt(0) || '?'}
                        </Text>
                    </View>
                </TouchableOpacity>
            </MapLibreGL.MarkerView>
        );
    };
    
    const renderProviderCard = ({ item }) => {
        const provider = item;
        const userData = provider.userData || {};
        const servicesList = provider.services ? provider.services.split(',').map(s => s.trim()) : [];
        
        return (
            <TouchableOpacity 
                style={searchStyles.card}
                onPress={() => handleProviderPress(provider)}
                activeOpacity={0.7}
            >
                <View style={searchStyles.cardHeader}>
                    <Image 
                        source={{ 
                            uri: getOptimizedImageUrl(userData.photoURL, 80, 80) || 
                                 `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.displayName || 'User')}` 
                        }}
                        style={searchStyles.cardAvatar}
                    />
                    <View style={searchStyles.cardInfo}>
                        <View style={searchStyles.nameRow}>
                            <Text style={searchStyles.cardName}>{userData.displayName || 'Anonymous'}</Text>
                            {userData.isActive && (
                                <View style={searchStyles.activeBadge}>
                                    <Text style={searchStyles.activeBadgeText}>Active</Text>
                                </View>
                            )}
                        </View>
                        <View style={searchStyles.ratingRow}>
                            <Text style={searchStyles.star}>★</Text>
                            <Text style={searchStyles.rating}>
                                {(userData.rating || 0).toFixed(1)} ({userData.reviewCount || 0})
                            </Text>
                        </View>
                    </View>
                </View>
                
                <View style={searchStyles.servicesContainer}>
                    {servicesList.slice(0, 2).map((service, index) => (
                        <View key={index} style={searchStyles.serviceTag}>
                            <Text style={searchStyles.serviceText}>{service}</Text>
                        </View>
                    ))}
                </View>
                
                <Text style={searchStyles.distance}>📍 {formatDistance(provider.distance_meters)}</Text>
            </TouchableOpacity>
        );
    };
    
    const renderListFooter = () => {
        if (!loadingMore) return null;
        return (
            <View style={searchStyles.loadingMore}>
                <ActivityIndicator size="small" color="#E67E22" />
            </View>
        );
    };
    
    const renderEmpty = () => {
        if (loading) {
            return (
                <View style={searchStyles.skeletonContainer}>
                    {[1, 2, 3].map(i => (
                        <View key={i} style={searchStyles.skeletonCard}>
                            <View style={searchStyles.skeletonHeader}>
                                <View style={searchStyles.skeletonAvatar} />
                                <View style={searchStyles.skeletonInfo}>
                                    <View style={searchStyles.skeletonLine} />
                                    <View style={[searchStyles.skeletonLine, searchStyles.skeletonShort]} />
                                </View>
                            </View>
                            <View style={searchStyles.skeletonTags}>
                                <View style={searchStyles.skeletonTag} />
                            </View>
                        </View>
                    ))}
                </View>
            );
        }
        
        return (
            <View style={searchStyles.emptyContainer}>
                <Text style={searchStyles.emptyText}>No providers found</Text>
                <Text style={searchStyles.emptySubtext}>Try a different service or increase radius</Text>
            </View>
        );
    };
    
    return (
        <View style={searchStyles.container}>
            <View style={searchStyles.header}>
                <Text style={searchStyles.headerTitle}>Search</Text>
            </View>
            
            <View style={searchStyles.searchContainer}>
                <TextInput
                    style={searchStyles.searchInput}
                    placeholder="What service do you need?"
                    placeholderTextColor="#8e8e8e"
                    value={searchQuery}
                    onChangeText={handleSearchChange}
                />
                
                <View style={searchStyles.viewToggle}>
                    <TouchableOpacity 
                        style={[searchStyles.toggleButton, viewMode === 'map' && searchStyles.toggleActive]}
                        onPress={() => setViewMode('map')}
                    >
                        <Text style={[searchStyles.toggleText, viewMode === 'map' && searchStyles.toggleTextActive]}>
                            Map
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[searchStyles.toggleButton, viewMode === 'list' && searchStyles.toggleActive]}
                        onPress={() => setViewMode('list')}
                    >
                        <Text style={[searchStyles.toggleText, viewMode === 'list' && searchStyles.toggleTextActive]}>
                            List
                        </Text>
                    </TouchableOpacity>
                </View>
                
                <View style={searchStyles.radiusContainer}>
                    <Text style={searchStyles.radiusLabel}>Radius: {radius} km</Text>
                    <View style={searchStyles.sliderContainer}>
                        <Text style={searchStyles.sliderMin}>1</Text>
                        <View style={searchStyles.sliderTrack}>
                            <TouchableOpacity
                                style={[
                                    searchStyles.sliderFill,
                                    { width: `${((radius - 1) / 19) * 100}%` }
                                ]}
                            />
                            <View 
                                style={[
                                    searchStyles.sliderThumb,
                                    { left: `${((radius - 1) / 19) * 100}%` }
                                ]}
                            />
                        </View>
                        <Text style={searchStyles.sliderMax}>20</Text>
                    </View>
                </View>
            </View>
            
            {viewMode === 'map' && userLocation ? (
                <View style={searchStyles.mapContainer}>
                    <MapLibreGL.MapView
                        ref={setMapRef}
                        style={searchStyles.map}
                        styleURL="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
                        centerCoordinate={[userLocation.lng, userLocation.lat]}
                        zoomLevel={radius <= 1 ? 14 : radius <= 2 ? 13 : radius <= 5 ? 12 : 11}
                    >
                        <MapLibreGL.Camera />
                        
                        {/* User location marker */}
                        <MapLibreGL.MarkerView
                            coordinate={[userLocation.lng, userLocation.lat]}
                            anchor={{ x: 0.5, y: 0.5 }}
                        >
                            <View style={searchStyles.userMarker}>
                                <View style={searchStyles.userMarkerInner} />
                            </View>
                        </MapLibreGL.MarkerView>
                        
                        {/* Provider markers */}
                        {providers.map(provider => renderMapMarker(provider))}
                    </MapLibreGL.MapView>
                    
                    <TouchableOpacity 
                        style={searchStyles.myLocationButton}
                        onPress={getCurrentLocation}
                    >
                        <Text style={searchStyles.myLocationIcon}>📍</Text>
                    </TouchableOpacity>
                </View>
            ) : viewMode === 'list' ? (
                <FlatList
                    data={providers}
                    renderItem={renderProviderCard}
                    keyExtractor={(item, index) => `${item.user_id}-${index}`}
                    contentContainerStyle={searchStyles.listContent}
                    onEndReached={handleLoadMore}
                    onEndReachedThreshold={0.3}
                    ListFooterComponent={renderListFooter}
                    ListEmptyComponent={renderEmpty}
                    showsVerticalScrollIndicator={false}
                />
            ) : null}
            
            <BottomSheet
                ref={bottomSheetRef}
                index={-1}
                snapPoints={['50%']}
                enablePanDownToClose
                backgroundStyle={bottomSheetStyles.background}
            >
                <BottomSheetScrollView contentContainerStyle={bottomSheetStyles.content}>
                    {selectedProvider && (
                        <View style={bottomSheetStyles.container}>
                            <Image 
                                source={{ 
                                    uri: getOptimizedImageUrl(selectedProvider.userData?.photoURL, 160, 160) || 
                                         `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedProvider.userData?.displayName || 'User')}` 
                                }}
                                style={bottomSheetStyles.avatar}
                            />
                            
                            <View style={bottomSheetStyles.nameRow}>
                                <Text style={bottomSheetStyles.name}>
                                    {selectedProvider.userData?.displayName || 'Anonymous'}
                                </Text>
                                {selectedProvider.userData?.isActive && (
                                    <View style={bottomSheetStyles.activeBadge}>
                                        <Text style={bottomSheetStyles.activeBadgeText}>Active</Text>
                                    </View>
                                )}
                            </View>
                            
                            <View style={bottomSheetStyles.ratingRow}>
                                <Text style={bottomSheetStyles.star}>★</Text>
                                <Text style={bottomSheetStyles.rating}>
                                    {(selectedProvider.userData?.rating || 0).toFixed(1)} ({selectedProvider.userData?.reviewCount || 0})
                                </Text>
                            </View>
                            
                            <Text style={bottomSheetStyles.distance}>
                                📍 {formatDistance(selectedProvider.distance_meters)}
                            </Text>
                            
                            <View style={bottomSheetStyles.buttonRow}>
                                <TouchableOpacity 
                                    style={bottomSheetStyles.primaryButton}
                                    onPress={handleViewFullProfile}
                                >
                                    <Text style={bottomSheetStyles.primaryButtonText}>View Full Profile</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity 
                                    style={bottomSheetStyles.secondaryButton}
                                    onPress={handleMessageProvider}
                                >
                                    <Text style={bottomSheetStyles.secondaryButtonText}>Message</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </BottomSheetScrollView>
            </BottomSheet>
        </View>
    );
}

// ========== SEARCH STYLES ==========
const searchStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    header: {
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingBottom: 10,
        backgroundColor: '#0f0f0f',
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#f5f5f5',
    },
    searchContainer: {
        padding: 16,
        backgroundColor: '#0f0f0f',
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    searchInput: {
        backgroundColor: '#1a1a1a',
        borderRadius: 30,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        color: '#f5f5f5',
        borderWidth: 1,
        borderColor: '#2c2c2c',
        marginBottom: 12,
    },
    viewToggle: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    toggleButton: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        backgroundColor: '#1a1a1a',
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    toggleActive: {
        backgroundColor: '#E67E22',
        borderColor: '#E67E22',
    },
    toggleText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#8e8e8e',
    },
    toggleTextActive: {
        color: '#fff',
    },
    radiusContainer: {
        marginTop: 8,
    },
    radiusLabel: {
        fontSize: 13,
        color: '#8e8e8e',
        marginBottom: 8,
    },
    sliderContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sliderMin: {
        fontSize: 12,
        color: '#8e8e8e',
        width: 20,
    },
    sliderMax: {
        fontSize: 12,
        color: '#8e8e8e',
        width: 25,
        textAlign: 'right',
    },
    sliderTrack: {
        flex: 1,
        height: 4,
        backgroundColor: '#2c2c2c',
        borderRadius: 2,
        marginHorizontal: 8,
        position: 'relative',
    },
    sliderFill: {
        height: 4,
        backgroundColor: '#E67E22',
        borderRadius: 2,
        position: 'absolute',
        left: 0,
    },
    sliderThumb: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#E67E22',
        position: 'absolute',
        top: -8,
        marginLeft: -10,
    },
    mapContainer: {
        flex: 1,
        position: 'relative',
    },
    map: {
        flex: 1,
    },
    userMarker: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: 'rgba(0, 150, 255, 0.3)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    userMarkerInner: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#0096ff',
        borderWidth: 2,
        borderColor: '#fff',
    },
    marker: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#fff',
    },
    markerText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    myLocationButton: {
        position: 'absolute',
        bottom: 20,
        right: 20,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#1a1a1a',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    myLocationIcon: {
        fontSize: 24,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 20,
    },
    card: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    cardAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: '#E67E22',
    },
    cardInfo: {
        flex: 1,
        marginLeft: 12,
    },
    cardName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#f5f5f5',
        marginRight: 8,
    },
    servicesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 8,
    },
    serviceTag: {
        backgroundColor: '#242424',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 20,
        marginRight: 8,
        marginBottom: 6,
    },
    serviceText: {
        fontSize: 11,
        color: '#f5f5f5',
    },
    distance: {
        fontSize: 12,
        color: '#8e8e8e',
    },
    loadingMore: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    emptyContainer: {
        paddingTop: 60,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#8e8e8e',
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#6c6c6c',
    },
    skeletonContainer: {
        paddingTop: 12,
        paddingHorizontal: 16,
    },
    skeletonCard: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    skeletonHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    skeletonAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#2c2c2c',
    },
    skeletonInfo: {
        flex: 1,
        marginLeft: 12,
    },
    skeletonLine: {
        height: 14,
        backgroundColor: '#2c2c2c',
        borderRadius: 4,
        marginBottom: 8,
        width: '100%',
    },
    skeletonShort: {
        width: '60%',
    },
    skeletonTags: {
        flexDirection: 'row',
    },
    skeletonTag: {
        width: 60,
        height: 24,
        backgroundColor: '#2c2c2c',
        borderRadius: 20,
    },
});

console.log('✅ app-features.js Part 2 loaded');

// ========================================
// CHATS LIST SCREEN
// ========================================

export function ChatsScreen({ navigation }) {
    const [chats, setChats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    
    const chatsUnsubscribeRef = useRef(null);
    
    useEffect(() => {
        loadChats();
        
        return () => {
            if (chatsUnsubscribeRef.current) {
                chatsUnsubscribeRef.current();
            }
        };
    }, []);
    
    const loadChats = () => {
        if (!auth.currentUser) return;
        
        setLoading(true);
        
        const chatsRef = collection(db, 'chats');
        const q = query(
            chatsRef,
            where('participants', 'array-contains', auth.currentUser.uid),
            orderBy('lastMessageTime', 'desc')
        );
        
        chatsUnsubscribeRef.current = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                setChats([]);
                setLoading(false);
                setRefreshing(false);
                return;
            }
            
            const chatsList = [];
            snapshot.forEach((doc) => {
                const chat = { id: doc.id, ...doc.data() };
                const otherUserId = chat.participants.find(p => p !== auth.currentUser.uid);
                const unreadCount = chat.unreadCount?.[auth.currentUser.uid] || 0;
                
                const otherUserInfo = chat.participantInfo?.[otherUserId] || {
                    displayName: 'User',
                    photoURL: null
                };
                
                chatsList.push({
                    ...chat,
                    otherUser: {
                        id: otherUserId,
                        displayName: otherUserInfo.displayName,
                        photoURL: otherUserInfo.photoURL
                    },
                    unreadCount
                });
            });
            
            setChats(chatsList);
            setLoading(false);
            setRefreshing(false);
        }, (error) => {
            console.error('Chats listener error:', error);
            setLoading(false);
            setRefreshing(false);
        });
    };
    
    const handleRefresh = () => {
        setRefreshing(true);
    };
    
    const handleChatPress = (chat) => {
        haptic('light');
        navigation.navigate('Chat', { 
            userId: chat.otherUser.id, 
            chatId: chat.id 
        });
    };
    
    const handleNewChat = () => {
        haptic('light');
        navigation.navigate('Search');
        global.showToast('Select a provider to start a chat', 'info');
    };
    
    const renderChatItem = ({ item }) => {
        const chat = item;
        const lastMessageTime = chat.lastMessageTime ? new Date(chat.lastMessageTime) : null;
        const timeString = lastMessageTime ? lastMessageTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        
        return (
            <TouchableOpacity 
                style={chatsStyles.chatItem}
                onPress={() => handleChatPress(chat)}
                activeOpacity={0.7}
            >
                <Image 
                    source={{ 
                        uri: getOptimizedImageUrl(chat.otherUser.photoURL, 100, 100) || 
                             `https://ui-avatars.com/api/?name=${encodeURIComponent(chat.otherUser.displayName || 'User')}` 
                    }}
                    style={chatsStyles.avatar}
                />
                <View style={chatsStyles.chatDetails}>
                    <View style={chatsStyles.nameRow}>
                        <Text style={chatsStyles.name}>{chat.otherUser.displayName || 'User'}</Text>
                        {chat.unreadCount > 0 && (
                            <View style={chatsStyles.unreadBadge}>
                                <Text style={chatsStyles.unreadText}>{chat.unreadCount}</Text>
                            </View>
                        )}
                    </View>
                    <Text style={chatsStyles.lastMessage} numberOfLines={1}>
                        {chat.lastMessage || 'No messages yet'}
                    </Text>
                </View>
                <View style={chatsStyles.chatMeta}>
                    <Text style={chatsStyles.time}>{timeString}</Text>
                    {chat.pendingReview && (
                        <View style={chatsStyles.pendingBadge}>
                            <Text style={chatsStyles.pendingText}>Pending</Text>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    };
    
    const renderEmpty = () => {
        if (loading) {
            return (
                <View style={chatsStyles.skeletonContainer}>
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <View key={i} style={chatsStyles.skeletonItem}>
                            <View style={chatsStyles.skeletonAvatar} />
                            <View style={chatsStyles.skeletonInfo}>
                                <View style={chatsStyles.skeletonLine} />
                                <View style={[chatsStyles.skeletonLine, chatsStyles.skeletonShort]} />
                            </View>
                        </View>
                    ))}
                </View>
            );
        }
        
        return (
            <View style={chatsStyles.emptyContainer}>
                <Text style={chatsStyles.emptyText}>No messages yet</Text>
                <TouchableOpacity style={chatsStyles.newChatButton} onPress={handleNewChat}>
                    <Text style={chatsStyles.newChatButtonText}>Start a conversation</Text>
                </TouchableOpacity>
            </View>
        );
    };
    
    return (
        <View style={chatsStyles.container}>
            <View style={chatsStyles.header}>
                <Text style={chatsStyles.headerTitle}>Messages</Text>
                <TouchableOpacity onPress={handleNewChat}>
                    <Text style={chatsStyles.newChatIcon}>✏️</Text>
                </TouchableOpacity>
            </View>
            
            <FlatList
                data={chats}
                renderItem={renderChatItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={chatsStyles.listContent}
                refreshControl={
                    <RefreshControl 
                        refreshing={refreshing} 
                        onRefresh={handleRefresh}
                        colors={['#E67E22']}
                        tintColor="#E67E22"
                    />
                }
                ListEmptyComponent={renderEmpty}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
}

// ========================================
// INDIVIDUAL CHAT SCREEN
// ========================================

export function ChatScreen({ route, navigation }) {
    const { userId, chatId: initialChatId } = route.params;
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [otherUser, setOtherUser] = useState(null);
    const [chatId, setChatId] = useState(initialChatId);
    const [gigStatus, setGigStatus] = useState(null);
    const [showReviewButton, setShowReviewButton] = useState(false);
    const [showCancelButton, setShowCancelButton] = useState(false);
    const [pendingToast, setPendingToast] = useState('');
    
    const messagesListRef = useRef(null);
    const messagesUnsubscribeRef = useRef(null);
    const gigStatusUnsubscribeRef = useRef(null);
    const lastVisibleRef = useRef(null);
    const bottomSheetRef = useRef(null);
    
    const MESSAGES_PER_PAGE = 30;
    
    useEffect(() => {
        loadOtherUser();
        initializeChat();
        
        return () => {
            if (messagesUnsubscribeRef.current) {
                messagesUnsubscribeRef.current();
            }
            if (gigStatusUnsubscribeRef.current) {
                gigStatusUnsubscribeRef.current();
            }
        };
    }, []);
    
    const loadOtherUser = async () => {
        const userData = await getSingleProfileFromFirestore(userId);
        setOtherUser(userData);
        
        // Set header title
        navigation.setOptions({
            headerTitle: userData?.displayName || 'Chat'
        });
    };
    
    const initializeChat = async () => {
        let finalChatId = initialChatId;
        
        if (!finalChatId) {
            const chatsRef = collection(db, 'chats');
            const q = query(
                chatsRef,
                where('participants', 'array-contains', auth.currentUser.uid)
            );
            
            const snapshot = await getDocs(q);
            let found = null;
            snapshot.forEach(doc => {
                if (doc.data().participants.includes(userId)) {
                    found = doc.id;
                }
            });
            
            if (found) {
                finalChatId = found;
            } else {
                const currentUserData = global.currentUserData || {};
                const otherUserData = await getSingleProfileFromFirestore(userId);
                
                const newChatRef = await addDoc(collection(db, 'chats'), {
                    participants: [auth.currentUser.uid, userId],
                    participantInfo: {
                        [auth.currentUser.uid]: {
                            displayName: currentUserData.displayName || 'User',
                            photoURL: currentUserData.photoURL || null
                        },
                        [userId]: {
                            displayName: otherUserData?.displayName || 'User',
                            photoURL: otherUserData?.photoURL || null
                        }
                    },
                    createdAt: new Date().toISOString(),
                    lastMessageTime: new Date().toISOString(),
                    lastMessage: '',
                    unreadCount: {}
                });
                finalChatId = newChatRef.id;
            }
            setChatId(finalChatId);
        }
        
        global.currentChatId = finalChatId;
        
        // Reset unread count
        const chatRef = doc(db, 'chats', finalChatId);
        await updateDoc(chatRef, {
            [`unreadCount.${auth.currentUser.uid}`]: 0
        });
        
        // Load messages
        loadMessages(finalChatId);
        
        // Check gig status
        checkGigStatus(finalChatId);
    };
    
    const loadMessages = (chatId) => {
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const q = query(
            messagesRef,
            orderBy('timestamp', 'desc'),
            limit(MESSAGES_PER_PAGE)
        );
        
        messagesUnsubscribeRef.current = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1];
                setHasMore(snapshot.docs.length === MESSAGES_PER_PAGE);
                
                const msgs = [];
                snapshot.docs.reverse().forEach(doc => {
                    msgs.push({ id: doc.id, ...doc.data() });
                });
                setMessages(msgs);
            } else {
                setMessages([]);
                setHasMore(false);
            }
            setLoading(false);
        });
    };
    
    const checkGigStatus = async (chatId) => {
        const gigsRef = collection(db, 'chats', chatId, 'gigs');
        const q = query(gigsRef, where('status', '==', 'pending_review'), limit(1));
        
        gigStatusUnsubscribeRef.current = onSnapshot(q, async (snapshot) => {
            if (snapshot.empty) {
                setGigStatus(null);
                setShowReviewButton(false);
                setShowCancelButton(false);
                setPendingToast('');
                return;
            }
            
            const gigDoc = snapshot.docs[0];
            const gigData = gigDoc.data();
            setGigStatus(gigData);
            
            const isProvider = gigData.providerId === auth.currentUser.uid;
            const isClient = gigData.clientId === auth.currentUser.uid;
            
            if (isProvider) {
                setPendingToast(`⏳ Waiting for client to review this gig`);
                setShowReviewButton(false);
                setShowCancelButton(false);
            } else if (isClient) {
                const providerName = otherUser?.displayName || 'Provider';
                setPendingToast(`⭐ You have a pending review for ${providerName}`);
                setShowReviewButton(true);
                setShowCancelButton(true);
            }
        });
    };
    
    const loadMoreMessages = async () => {
        if (!hasMore || loadingMore || !lastVisibleRef.current || !chatId) return;
        
        setLoadingMore(true);
        
        try {
            const messagesRef = collection(db, 'chats', chatId, 'messages');
            const q = query(
                messagesRef,
                orderBy('timestamp', 'desc'),
                startAfter(lastVisibleRef.current),
                limit(MESSAGES_PER_PAGE)
            );
            
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1];
                setHasMore(snapshot.docs.length === MESSAGES_PER_PAGE);
                
                const olderMsgs = [];
                snapshot.docs.reverse().forEach(doc => {
                    olderMsgs.push({ id: doc.id, ...doc.data() });
                });
                
                setMessages(prev => [...olderMsgs, ...prev]);
            } else {
                setHasMore(false);
            }
        } catch (error) {
            console.error('Load more error:', error);
        } finally {
            setLoadingMore(false);
        }
    };
    
    const handleSendMessage = async () => {
        if (!inputText.trim() || !chatId) return;
        
        const text = inputText.trim();
        setInputText('');
        haptic('light');
        
        try {
            const messagesRef = collection(db, 'chats', chatId, 'messages');
            await addDoc(messagesRef, {
                senderId: auth.currentUser.uid,
                text: text,
                timestamp: new Date().toISOString()
            });
            
            const chatRef = doc(db, 'chats', chatId);
            const chatDoc = await getDoc(chatRef);
            const chatData = chatDoc.data();
            const otherUserId = chatData.participants.find(p => p !== auth.currentUser.uid);
            
            await updateDoc(chatRef, {
                lastMessage: text,
                lastMessageTime: new Date().toISOString(),
                [`unreadCount.${otherUserId}`]: increment(1)
            });
            
            const senderName = global.currentUserData?.displayName || 'Someone';
            await sendPushNotification(
                otherUserId,
                'New Message',
                `${senderName}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
                `/chat/${chatId}`
            );
            
        } catch (error) {
            console.error('Send message error:', error);
            global.showToast('Error sending message', 'error');
        }
    };
    
    const handleAttachImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
        });
        
        if (!result.canceled && result.assets[0]) {
            global.showToast('Uploading image...');
            haptic('light');
            
            try {
                const imageUrl = await uploadImage(result.assets[0].uri, 'chat-images');
                
                if (imageUrl) {
                    const messagesRef = collection(db, 'chats', chatId, 'messages');
                    await addDoc(messagesRef, {
                        senderId: auth.currentUser.uid,
                        imageUrl: imageUrl,
                        timestamp: new Date().toISOString()
                    });
                    
                    const chatRef = doc(db, 'chats', chatId);
                    const chatDoc = await getDoc(chatRef);
                    const chatData = chatDoc.data();
                    const otherUserId = chatData.participants.find(p => p !== auth.currentUser.uid);
                    
                    await updateDoc(chatRef, {
                        lastMessage: '📷 Image',
                        lastMessageTime: new Date().toISOString(),
                        [`unreadCount.${otherUserId}`]: increment(1)
                    });
                    
                    global.showToast('Image sent!', 'success');
                }
            } catch (error) {
                console.error('Image upload error:', error);
                global.showToast('Error uploading image', 'error');
            }
        }
    };
    
    const handleRegisterGig = async () => {
        if (!chatId || !userId) return;
        
        Alert.alert(
            'Register Gig',
            'Register a gig with this client? Credit will be deducted when they submit a review.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Register',
                    onPress: async () => {
                        await registerGig(chatId, userId);
                    }
                }
            ]
        );
    };
    
    const handleSubmitReview = () => {
        showReviewBottomSheet(userId, chatId);
    };
    
    const handleCancelGig = async () => {
        Alert.alert(
            'Cancel Gig',
            'Are you sure you want to cancel this gig?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes, Cancel',
                    style: 'destructive',
                    onPress: async () => {
                        await cancelGig(chatId, userId);
                    }
                }
            ]
        );
    };
    
    const handleHeaderPress = () => {
        global.currentViewedUserId = userId;
        navigation.navigate('Profile', { userId });
    };
    
    const handleMessageLongPress = (message) => {
        if (message.senderId !== auth.currentUser.uid) return;
        
        haptic('medium');
        
        Alert.alert(
            'Message Options',
            '',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const msgRef = doc(db, 'chats', chatId, 'messages', message.id);
                            await deleteDoc(msgRef);
                            global.showToast('Message deleted', 'info');
                        } catch (error) {
                            global.showToast('Error deleting message', 'error');
                        }
                    }
                }
            ]
        );
    };
    
    const renderMessage = ({ item }) => {
        const isMe = item.senderId === auth.currentUser?.uid;
        
        return (
            <TouchableOpacity
                onLongPress={() => handleMessageLongPress(item)}
                activeOpacity={0.8}
            >
                <View style={[chatStyles.messageWrapper, isMe ? chatStyles.myMessageWrapper : chatStyles.theirMessageWrapper]}>
                    <View style={[chatStyles.messageBubble, isMe ? chatStyles.myBubble : chatStyles.theirBubble]}>
                        {item.text ? (
                            <Text style={[chatStyles.messageText, isMe ? chatStyles.myMessageText : chatStyles.theirMessageText]}>
                                {item.text}
                            </Text>
                        ) : null}
                        {item.imageUrl ? (
                            <Image source={{ uri: item.imageUrl }} style={chatStyles.messageImage} />
                        ) : null}
                        <Text style={chatStyles.messageTime}>
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };
    
    const renderHeader = () => {
        if (!loadingMore) return null;
        return (
            <View style={chatStyles.loadingMore}>
                <ActivityIndicator size="small" color="#E67E22" />
            </View>
        );
    };
    
    return (
        <KeyboardAvoidingView 
            style={chatStyles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
            <TouchableOpacity 
                style={chatStyles.headerInfo}
                onPress={handleHeaderPress}
                activeOpacity={0.7}
            >
                <Image 
                    source={{ 
                        uri: getOptimizedImageUrl(otherUser?.photoURL, 80, 80) || 
                             `https://ui-avatars.com/api/?name=${encodeURIComponent(otherUser?.displayName || 'User')}` 
                    }}
                    style={chatStyles.headerAvatar}
                />
                <Text style={chatStyles.headerName}>{otherUser?.displayName || 'Chat'}</Text>
            </TouchableOpacity>
            
            {pendingToast ? (
                <View style={chatStyles.pendingToast}>
                    <Text style={chatStyles.pendingToastText}>{pendingToast}</Text>
                </View>
            ) : null}
            
            <FlatList
                ref={messagesListRef}
                data={messages}
                renderItem={renderMessage}
                keyExtractor={(item) => item.id}
                contentContainerStyle={chatStyles.messagesList}
                inverted={false}
                onEndReached={loadMoreMessages}
                onEndReachedThreshold={0.3}
                ListHeaderComponent={renderHeader}
                showsVerticalScrollIndicator={false}
            />
            
            <View style={chatStyles.inputContainer}>
                {!gigStatus && !showReviewButton && (
                    <>
                        <TouchableOpacity 
                            style={chatStyles.attachButton}
                            onPress={handleAttachImage}
                        >
                            <Text style={chatStyles.attachIcon}>📎</Text>
                        </TouchableOpacity>
                        
                        <TextInput
                            style={chatStyles.input}
                            placeholder="Type a message..."
                            placeholderTextColor="#8e8e8e"
                            value={inputText}
                            onChangeText={setInputText}
                            multiline
                        />
                        
                        <TouchableOpacity 
                            style={chatStyles.sendButton}
                            onPress={handleSendMessage}
                            disabled={!inputText.trim()}
                        >
                            <Text style={[
                                chatStyles.sendIcon,
                                !inputText.trim() && chatStyles.sendIconDisabled
                            ]}>➤</Text>
                        </TouchableOpacity>
                    </>
                )}
                
                {!gigStatus && !showReviewButton && auth.currentUser?.uid && (
                    <TouchableOpacity 
                        style={chatStyles.registerButton}
                        onPress={handleRegisterGig}
                    >
                        <Text style={chatStyles.registerButtonText}>📋 Register Gig</Text>
                    </TouchableOpacity>
                )}
                
                {showReviewButton && (
                    <View style={chatStyles.actionButtons}>
                        <TouchableOpacity 
                            style={chatStyles.reviewButton}
                            onPress={handleSubmitReview}
                        >
                            <Text style={chatStyles.reviewButtonText}>⭐ Submit Review</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={chatStyles.cancelButton}
                            onPress={handleCancelGig}
                        >
                            <Text style={chatStyles.cancelButtonText}>❌ Cancel Gig</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </KeyboardAvoidingView>
    );
}

// ========== CHATS LIST STYLES ==========
const chatsStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingBottom: 10,
        backgroundColor: '#0f0f0f',
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#f5f5f5',
    },
    newChatIcon: {
        fontSize: 24,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 20,
    },
    chatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
    },
    chatDetails: {
        flex: 1,
        marginLeft: 12,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    name: {
        fontSize: 15,
        fontWeight: '600',
        color: '#f5f5f5',
        marginRight: 8,
    },
    unreadBadge: {
        backgroundColor: '#E67E22',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 20,
        minWidth: 18,
        alignItems: 'center',
    },
    unreadText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '600',
    },
    lastMessage: {
        fontSize: 13,
        color: '#8e8e8e',
    },
    chatMeta: {
        alignItems: 'flex-end',
    },
    time: {
        fontSize: 11,
        color: '#6c6c6c',
        marginBottom: 4,
    },
    pendingBadge: {
        backgroundColor: '#fbbc04',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 20,
    },
    pendingText: {
        color: '#000',
        fontSize: 10,
        fontWeight: '600',
    },
    emptyContainer: {
        paddingTop: 60,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#8e8e8e',
        marginBottom: 20,
    },
    newChatButton: {
        backgroundColor: '#E67E22',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 30,
    },
    newChatButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    skeletonContainer: {
        paddingTop: 8,
    },
    skeletonItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    skeletonAvatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#2c2c2c',
    },
    skeletonInfo: {
        flex: 1,
        marginLeft: 12,
    },
    skeletonLine: {
        height: 14,
        backgroundColor: '#2c2c2c',
        borderRadius: 4,
        marginBottom: 8,
        width: '100%',
    },
    skeletonShort: {
        width: '60%',
    },
});

// ========== CHAT SCREEN STYLES ==========
const chatStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    headerInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: '#0f0f0f',
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    headerAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#E67E22',
    },
    headerName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#f5f5f5',
        marginLeft: 12,
    },
    pendingToast: {
        backgroundColor: '#fbbc04',
        paddingVertical: 10,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    pendingToastText: {
        color: '#000',
        fontSize: 13,
        fontWeight: '500',
    },
    messagesList: {
        paddingHorizontal: 12,
        paddingVertical: 16,
        flexGrow: 1,
    },
    messageWrapper: {
        marginBottom: 8,
    },
    myMessageWrapper: {
        alignItems: 'flex-end',
    },
    theirMessageWrapper: {
        alignItems: 'flex-start',
    },
    messageBubble: {
        maxWidth: '75%',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 18,
    },
    myBubble: {
        backgroundColor: '#E67E22',
    },
    theirBubble: {
        backgroundColor: '#1a1a1a',
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    messageText: {
        fontSize: 15,
        lineHeight: 20,
    },
    myMessageText: {
        color: '#fff',
    },
    theirMessageText: {
        color: '#f5f5f5',
    },
    messageImage: {
        width: 200,
        height: 200,
        borderRadius: 12,
        marginBottom: 4,
    },
    messageTime: {
        fontSize: 10,
        opacity: 0.7,
        marginTop: 4,
        textAlign: 'right',
    },
    loadingMore: {
        paddingVertical: 12,
        alignItems: 'center',
    },
    inputContainer: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: '#0f0f0f',
        borderTopWidth: 1,
        borderTopColor: '#2c2c2c',
    },
    attachButton: {
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    attachIcon: {
        fontSize: 24,
    },
    input: {
        flex: 1,
        backgroundColor: '#1a1a1a',
        borderRadius: 30,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 15,
        color: '#f5f5f5',
        borderWidth: 1,
        borderColor: '#2c2c2c',
        maxHeight: 100,
    },
    sendButton: {
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    sendIcon: {
        fontSize: 24,
        color: '#E67E22',
    },
    sendIconDisabled: {
        opacity: 0.3,
    },
    registerButton: {
        backgroundColor: '#E67E22',
        borderRadius: 30,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    registerButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 8,
    },
    reviewButton: {
        flex: 1,
        backgroundColor: '#E67E22',
        borderRadius: 30,
        paddingVertical: 12,
        alignItems: 'center',
    },
    reviewButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    cancelButton: {
        flex: 1,
        backgroundColor: 'transparent',
        borderRadius: 30,
        paddingVertical: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#ea4335',
    },
    cancelButtonText: {
        color: '#ea4335',
        fontSize: 16,
        fontWeight: '600',
    },
});

console.log('✅ app-features.js Part 3 loaded');

// ========================================
// PROFILE SCREEN
// ========================================

export function ProfileScreen({ route, navigation }) {
    const { userId: routeUserId } = route.params || {};
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [isOwnProfile, setIsOwnProfile] = useState(true);
    
    const paystackRef = useRef(null);
    const bottomSheetRef = useRef(null);
    
    const targetUserId = routeUserId || auth.currentUser?.uid;
    
    useEffect(() => {
        setIsOwnProfile(targetUserId === auth.currentUser?.uid);
        loadProfile();
    }, [targetUserId]);
    
    const loadProfile = async () => {
        try {
            const userRef = doc(db, 'users', targetUserId);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) {
                setProfile(null);
                setLoading(false);
                return;
            }
            
            const profileData = userSnap.data();
            
            let lastGigDate = null;
            try {
                const { data: locationData } = await supabase
                    .from('provider_locations')
                    .select('last_gig_date')
                    .eq('user_id', targetUserId)
                    .single();
                lastGigDate = locationData?.last_gig_date;
            } catch (err) {}
            
            let gigsLast7Days = profileData.gigsLast7Days || 0;
            let gigsLast30Days = profileData.gigsLast30Days || 0;
            
            if (typeof recalculateStaleCounters === 'function') {
                const freshCounts = await recalculateStaleCounters(targetUserId);
                if (freshCounts) {
                    gigsLast7Days = freshCounts.gigsLast7Days;
                    gigsLast30Days = freshCounts.gigsLast30Days;
                }
            }
            
            const isActive = (gigsLast7Days >= 1) || (gigsLast30Days >= 3);
            const hasCompletedGigs = (profileData.gigCount || 0) > 0;
            
            setProfile({
                id: targetUserId,
                displayName: profileData.displayName || 'Anonymous',
                photoURL: profileData.photoURL || null,
                bio: profileData.bio || '',
                phone: profileData.phone || '',
                addressText: profileData.addressText || '',
                services: profileData.services || [],
                portfolio: profileData.portfolio || [],
                credits: profileData.credits || 0,
                gigCount: profileData.gigCount || 0,
                rating: profileData.rating || 0,
                reviewCount: profileData.reviewCount || 0,
                gigsLast30Days: gigsLast30Days,
                isActive: isActive,
                hasCompletedGigs: hasCompletedGigs
            });
            
            if (!isOwnProfile) {
                navigation.setOptions({ headerTitle: profileData.displayName || 'Profile' });
                global.currentViewedUserId = targetUserId;
            }
            
        } catch (error) {
            console.error('Load profile error:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };
    
    const handleRefresh = () => {
        setRefreshing(true);
        loadProfile();
    };
    
    const handleEditProfile = () => {
        bottomSheetRef.current?.expand();
    };
    
    const handleBuyCredits = () => {
        const packages = [
            { credits: 5, price: 2500 },
            { credits: 10, price: 4500 },
            { credits: 20, price: 8000 }
        ];
        
        Alert.alert(
            'Buy Credits',
            'Select a package',
            packages.map(pkg => ({
                text: `${pkg.credits} credits - ₦${pkg.price.toLocaleString()}`,
                onPress: () => processCreditPurchase(pkg.credits, pkg.price)
            })).concat([{ text: 'Cancel', style: 'cancel' }])
        );
    };
    
    const processCreditPurchase = async (credits, price) => {
        if (!paystackRef.current) {
            global.showToast('Payment system initializing...', 'info');
            return;
        }
        
        try {
            const reference = `gc_${Date.now()}_${auth.currentUser.uid.slice(0, 8)}`;
            
            paystackRef.current.initializePayment({
                amount: price * 100,
                email: auth.currentUser.email,
                reference: reference,
                currency: 'NGN',
                channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer']
            });
            
        } catch (error) {
            console.error('Paystack error:', error);
            global.showToast('Error initializing payment', 'error');
        }
    };
    
    const handlePaymentSuccess = async (response) => {
        const credits = parseInt(response.metadata?.credits || 5);
        const price = response.amount / 100;
        
        try {
            const userRef = doc(db, 'users', auth.currentUser.uid);
            const userSnap = await getDoc(userRef);
            const currentCredits = userSnap.data()?.credits || 0;
            
            await updateDoc(userRef, {
                credits: currentCredits + credits,
                updatedAt: new Date().toISOString()
            });
            
            const transactionsRef = collection(db, 'transactions');
            await addDoc(transactionsRef, {
                userId: auth.currentUser.uid,
                type: 'credit_purchase',
                credits: credits,
                amount: price,
                reference: response.reference,
                createdAt: new Date().toISOString()
            });
            
            setProfile(prev => ({ ...prev, credits: currentCredits + credits }));
            global.currentUserData.credits = currentCredits + credits;
            
            global.showToast(`Added ${credits} credits!`, 'success');
            haptic('heavy');
            
        } catch (error) {
            console.error('Credit update error:', error);
            global.showToast('Error updating credits', 'error');
        }
    };
    
    const handleEditServices = async () => {
        const currentServices = profile?.services || [];
        
        Alert.alert(
            'Edit Services',
            'Select services you offer',
            PRESET_SERVICES.slice(0, 10).map(service => ({
                text: `${currentServices.includes(service) ? '✅ ' : ''}${service}`,
                onPress: () => toggleService(service)
            })).concat([
                { text: 'Save', onPress: saveServices },
                { text: 'Cancel', style: 'cancel' }
            ])
        );
    };
    
    const toggleService = (service) => {
        let currentServices = profile?.services || [];
        if (currentServices.includes(service)) {
            currentServices = currentServices.filter(s => s !== service);
        } else {
            currentServices.push(service);
        }
        setProfile(prev => ({ ...prev, services: currentServices }));
    };
    
    const saveServices = async () => {
        try {
            const userRef = doc(db, 'users', auth.currentUser.uid);
            await updateDoc(userRef, {
                services: profile.services,
                updatedAt: new Date().toISOString()
            });
            
            const servicesString = profile.services.join(', ');
            await supabase
                .from('provider_locations')
                .update({ services: servicesString })
                .eq('user_id', auth.currentUser.uid);
            
            global.showToast('Services updated!', 'success');
        } catch (error) {
            global.showToast('Error updating services', 'error');
        }
    };
    
    const handleAddPortfolio = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
        });
        
        if (!result.canceled && result.assets[0]) {
            global.showToast('Uploading...');
            
            try {
                const imageUrl = await uploadImage(result.assets[0].uri, 'portfolio');
                
                if (imageUrl) {
                    const userRef = doc(db, 'users', auth.currentUser.uid);
                    const userSnap = await getDoc(userRef);
                    const currentPortfolio = userSnap.data()?.portfolio || [];
                    
                    if (currentPortfolio.length >= 15) {
                        global.showToast('Maximum 15 images', 'error');
                        return;
                    }
                    
                    currentPortfolio.push(imageUrl);
                    await updateDoc(userRef, {
                        portfolio: currentPortfolio,
                        updatedAt: new Date().toISOString()
                    });
                    
                    setProfile(prev => ({ ...prev, portfolio: currentPortfolio }));
                    global.showToast('Portfolio updated!', 'success');
                }
            } catch (error) {
                global.showToast('Error uploading', 'error');
            }
        }
    };
    
    const handleContactNow = () => {
        if (!isOwnProfile && targetUserId) {
            navigation.navigate('Chat', { userId: targetUserId });
        }
    };
    
    const handleSettings = () => {
        navigation.navigate('Settings');
    };
    
    const handleRegisterGig = () => {
        showRecentChatsForGig();
    };
    
    const handleViewReviews = () => {
        showReviews(targetUserId);
    };
    
    const renderProfileHeader = () => (
        <View style={profileStyles.header}>
            <TouchableOpacity onPress={() => {
                if (profile?.photoURL) {
                    // Open full screen image
                }
            }}>
                <Image 
                    source={{ 
                        uri: getOptimizedImageUrl(profile?.photoURL, 200, 200) || 
                             `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.displayName || 'User')}` 
                    }}
                    style={profileStyles.avatar}
                />
            </TouchableOpacity>
            
            <Text style={profileStyles.name}>{profile?.displayName || 'Anonymous'}</Text>
            <Text style={profileStyles.bio}>{profile?.bio || 'No bio yet'}</Text>
            
            {profile?.hasCompletedGigs && profile?.isActive && (
                <View style={profileStyles.activeBadge}>
                    <Text style={profileStyles.activeBadgeText}>Active</Text>
                </View>
            )}
        </View>
    );
    
    const renderStats = () => (
        <View style={profileStyles.statsContainer}>
            <View style={profileStyles.statItem}>
                <Text style={profileStyles.statNumber}>{profile?.gigCount || 0}</Text>
                <Text style={profileStyles.statLabel}>Gigs</Text>
            </View>
            <TouchableOpacity style={profileStyles.statItem} onPress={handleViewReviews}>
                <Text style={profileStyles.statNumber}>★ {(profile?.rating || 0).toFixed(1)}</Text>
                <Text style={profileStyles.statLabel}>Rating</Text>
            </TouchableOpacity>
            <View style={profileStyles.statItem}>
                <Text style={profileStyles.statNumber}>{profile?.credits || 0}</Text>
                <Text style={profileStyles.statLabel}>Credits</Text>
            </View>
        </View>
    );
    
    const renderActions = () => {
        if (isOwnProfile) {
            return (
                <View style={profileStyles.actionsContainer}>
                    <TouchableOpacity style={profileStyles.secondaryButton} onPress={handleEditProfile}>
                        <Text style={profileStyles.secondaryButtonText}>Edit Profile</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={profileStyles.primaryButton} onPress={handleRegisterGig}>
                        <Text style={profileStyles.primaryButtonText}>Register Gig</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={profileStyles.primaryButton} onPress={handleBuyCredits}>
                        <Text style={profileStyles.primaryButtonText}>Buy Credits</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={profileStyles.secondaryButton} onPress={handleSettings}>
                        <Text style={profileStyles.secondaryButtonText}>Settings</Text>
                    </TouchableOpacity>
                </View>
            );
        } else {
            return (
                <View style={profileStyles.actionsContainer}>
                    <TouchableOpacity style={profileStyles.primaryButton} onPress={handleContactNow}>
                        <Text style={profileStyles.primaryButtonText}>Contact Now</Text>
                    </TouchableOpacity>
                </View>
            );
        }
    };
    
    const renderServices = () => (
        <View style={profileStyles.section}>
            <View style={profileStyles.sectionHeader}>
                <Text style={profileStyles.sectionTitle}>Services Offered</Text>
                {isOwnProfile && (
                    <TouchableOpacity onPress={handleEditServices}>
                        <Text style={profileStyles.editText}>Edit</Text>
                    </TouchableOpacity>
                )}
            </View>
            <View style={profileStyles.servicesList}>
                {(profile?.services || []).map((service, index) => (
                    <View key={index} style={profileStyles.serviceTag}>
                        <Text style={profileStyles.serviceText}>{service}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
    
    const renderPortfolio = () => (
        <View style={profileStyles.section}>
            <View style={profileStyles.sectionHeader}>
                <Text style={profileStyles.sectionTitle}>Portfolio</Text>
                {isOwnProfile && (
                    <TouchableOpacity onPress={handleAddPortfolio}>
                        <Text style={profileStyles.editText}>+ Add</Text>
                    </TouchableOpacity>
                )}
            </View>
            <View style={profileStyles.portfolioGrid}>
                {(profile?.portfolio || []).map((image, index) => (
                    <Image key={index} source={{ uri: image }} style={profileStyles.portfolioImage} />
                ))}
            </View>
        </View>
    );
    
    if (loading) {
        return (
            <View style={profileStyles.container}>
                <View style={profileStyles.loadingContainer}>
                    <ActivityIndicator size="large" color="#E67E22" />
                </View>
            </View>
        );
    }
    
    if (!profile) {
        return (
            <View style={profileStyles.container}>
                <View style={profileStyles.emptyContainer}>
                    <Text style={profileStyles.emptyText}>User not found</Text>
                </View>
            </View>
        );
    }
    
    return (
        <View style={profileStyles.container}>
            <Paystack
                ref={paystackRef}
                publicKey="pk_test_4f6ae42964ab8da60e2f1c77cfb6fe1cd30806cc"
                onSuccess={handlePaymentSuccess}
                onCancel={() => global.showToast('Payment cancelled', 'info')}
            />
            
            <ScrollView
                contentContainerStyle={profileStyles.content}
                refreshControl={
                    <RefreshControl 
                        refreshing={refreshing} 
                        onRefresh={handleRefresh}
                        colors={['#E67E22']}
                        tintColor="#E67E22"
                    />
                }
                showsVerticalScrollIndicator={false}
            >
                {renderProfileHeader()}
                {renderStats()}
                {profile?.hasCompletedGigs && (
                    <Text style={profileStyles.monthlyGigs}>
                        {profile.isActive ? '🔥 ' : ''}{profile.gigsLast30Days} gigs this month
                    </Text>
                )}
                <View style={profileStyles.addressContainer}>
                    <Text style={profileStyles.address}>📍 {profile.addressText || 'No address set'}</Text>
                </View>
                {renderActions()}
                {renderServices()}
                {renderPortfolio()}
            </ScrollView>
            
            <BottomSheet
                ref={bottomSheetRef}
                index={-1}
                snapPoints={['70%']}
                enablePanDownToClose
                backgroundStyle={bottomSheetStyles.background}
            >
                <EditProfileSheet 
                    profile={profile} 
                    onClose={() => bottomSheetRef.current?.close()}
                    onUpdate={(updated) => {
                        setProfile(updated);
                        bottomSheetRef.current?.close();
                    }}
                />
            </BottomSheet>
        </View>
    );
}

// ========================================
// EDIT PROFILE BOTTOM SHEET
// ========================================

function EditProfileSheet({ profile, onClose, onUpdate }) {
    const [displayName, setDisplayName] = useState(profile?.displayName || '');
    const [phone, setPhone] = useState(profile?.phone || '');
    const [bio, setBio] = useState(profile?.bio || '');
    const [addressText, setAddressText] = useState(profile?.addressText || '');
    const [photoURL, setPhotoURL] = useState(profile?.photoURL);
    const [loading, setLoading] = useState(false);
    
    const handlePickPhoto = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
        });
        
        if (!result.canceled) {
            setPhotoURL(result.assets[0].uri);
        }
    };
    
    const handleSave = async () => {
        setLoading(true);
        
        try {
            let uploadedPhotoURL = photoURL;
            
            if (photoURL && photoURL !== profile?.photoURL && !photoURL.startsWith('http')) {
                uploadedPhotoURL = await uploadImage(photoURL, 'profiles');
            }
            
            const userRef = doc(db, 'users', auth.currentUser.uid);
            const updates = {
                displayName: displayName || 'User',
                phone: phone || '',
                bio: bio || '',
                addressText: addressText || '',
                photoURL: uploadedPhotoURL || null,
                updatedAt: new Date().toISOString()
            };
            
            await updateDoc(userRef, updates);
            
            if (displayName) {
                await updateProfile(auth.currentUser, { displayName, photoURL: uploadedPhotoURL });
            }
            
            global.currentUserData = { ...global.currentUserData, ...updates };
            
            onUpdate({ ...profile, ...updates });
            global.showToast('Profile updated!', 'success');
            haptic('success');
            onClose();
            
        } catch (error) {
            console.error('Update error:', error);
            global.showToast('Error updating profile', 'error');
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <BottomSheetScrollView contentContainerStyle={editProfileStyles.content}>
            <Text style={editProfileStyles.title}>Edit Profile</Text>
            
            <TouchableOpacity style={editProfileStyles.photoContainer} onPress={handlePickPhoto}>
                {photoURL ? (
                    <Image source={{ uri: photoURL }} style={editProfileStyles.photo} />
                ) : (
                    <Text style={editProfileStyles.photoPlaceholder}>📸</Text>
                )}
                <Text style={editProfileStyles.photoText}>Tap to change photo</Text>
            </TouchableOpacity>
            
            <TextInput
                style={editProfileStyles.input}
                placeholder="Full Name"
                placeholderTextColor="#8e8e8e"
                value={displayName}
                onChangeText={setDisplayName}
            />
            
            <TextInput
                style={editProfileStyles.input}
                placeholder="Phone Number"
                placeholderTextColor="#8e8e8e"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
            />
            
            <TextInput
                style={[editProfileStyles.input, editProfileStyles.textArea]}
                placeholder="Bio"
                placeholderTextColor="#8e8e8e"
                value={bio}
                onChangeText={setBio}
                multiline
                numberOfLines={3}
            />
            
            <TextInput
                style={[editProfileStyles.input, editProfileStyles.textArea]}
                placeholder="Address"
                placeholderTextColor="#8e8e8e"
                value={addressText}
                onChangeText={setAddressText}
                multiline
                numberOfLines={2}
            />
            
            <TouchableOpacity 
                style={editProfileStyles.saveButton}
                onPress={handleSave}
                disabled={loading}
            >
                {loading ? (
                    <ActivityIndicator color="#fff" />
                ) : (
                    <Text style={editProfileStyles.saveButtonText}>Save Changes</Text>
                )}
            </TouchableOpacity>
        </BottomSheetScrollView>
    );
}

// ========== PROFILE STYLES ==========
const profileStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    content: {
        paddingBottom: 30,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        alignItems: 'center',
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
        paddingHorizontal: 16,
    },
    avatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 3,
        borderColor: '#E67E22',
        marginBottom: 12,
    },
    name: {
        fontSize: 22,
        fontWeight: '600',
        color: '#f5f5f5',
        marginBottom: 8,
    },
    bio: {
        fontSize: 14,
        color: '#8e8e8e',
        textAlign: 'center',
        marginBottom: 12,
    },
    activeBadge: {
        backgroundColor: '#4caf50',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 20,
    },
    activeBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '500',
    },
    statsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        paddingVertical: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    statItem: {
        alignItems: 'center',
    },
    statNumber: {
        fontSize: 22,
        fontWeight: '700',
        color: '#f5f5f5',
    },
    statLabel: {
        fontSize: 12,
        color: '#8e8e8e',
        marginTop: 4,
    },
    monthlyGigs: {
        fontSize: 14,
        color: '#E67E22',
        fontWeight: '500',
        textAlign: 'center',
        paddingVertical: 8,
    },
    addressContainer: {
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    address: {
        fontSize: 14,
        color: '#8e8e8e',
    },
    actionsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
        gap: 12,
    },
    primaryButton: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: '#E67E22',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    secondaryButton: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    secondaryButtonText: {
        color: '#f5f5f5',
        fontSize: 14,
        fontWeight: '600',
    },
    section: {
        paddingVertical: 20,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#f5f5f5',
    },
    editText: {
        fontSize: 14,
        color: '#E67E22',
        fontWeight: '500',
    },
    servicesList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    serviceTag: {
        backgroundColor: '#1a1a1a',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        marginRight: 8,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    serviceText: {
        fontSize: 13,
        color: '#f5f5f5',
    },
    portfolioGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    portfolioImage: {
        width: (Dimensions.get('window').width - 48) / 3,
        height: (Dimensions.get('window').width - 48) / 3,
        borderRadius: 12,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 16,
        color: '#8e8e8e',
    },
});

// ========== EDIT PROFILE STYLES ==========
const editProfileStyles = StyleSheet.create({
    content: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 30,
    },
    title: {
        fontSize: 20,
        fontWeight: '600',
        color: '#f5f5f5',
        textAlign: 'center',
        marginBottom: 20,
    },
    photoContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    photo: {
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 3,
        borderColor: '#E67E22',
        marginBottom: 8,
    },
    photoPlaceholder: {
        fontSize: 48,
        backgroundColor: '#1a1a1a',
        width: 100,
        height: 100,
        borderRadius: 50,
        textAlign: 'center',
        lineHeight: 100,
        borderWidth: 3,
        borderColor: '#E67E22',
        marginBottom: 8,
        color: '#f5f5f5',
    },
    photoText: {
        fontSize: 14,
        color: '#E67E22',
    },
    input: {
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#f5f5f5',
        borderWidth: 1,
        borderColor: '#2c2c2c',
        marginBottom: 16,
    },
    textArea: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
    saveButton: {
        backgroundColor: '#E67E22',
        borderRadius: 30,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 8,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});

console.log('✅ app-features.js Part 4 loaded');

// ========================================
// ADMIN SCREEN
// ========================================

export function AdminScreen({ navigation }) {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showGiftPanel, setShowGiftPanel] = useState(false);
    const [showRequestsPanel, setShowRequestsPanel] = useState(false);
    const [showUsersPanel, setShowUsersPanel] = useState(false);
    
    const adminEmail = 'theprimestarventures@gmail.com';
    
    useEffect(() => {
        checkAdminAccess();
        loadStats();
    }, []);
    
    const checkAdminAccess = () => {
        if (auth.currentUser?.email !== adminEmail) {
            navigation.goBack();
            global.showToast('Access Denied', 'error');
        }
    };
    
    const loadStats = async () => {
        try {
            const statsRef = doc(db, 'admin_stats', 'stats');
            const statsSnap = await getDoc(statsRef);
            
            if (statsSnap.exists()) {
                setStats(statsSnap.data());
            } else {
                setStats({
                    totalUsers: 0,
                    totalGigs: 0,
                    totalCreditsPurchased: 0,
                    totalRevenue: 0,
                    pendingRequests: 0,
                    usersJoinedToday: 0,
                    usersJoinedWeek: 0,
                    usersJoinedMonth: 0,
                    usersJoinedYear: 0
                });
            }
        } catch (error) {
            console.error('Load stats error:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };
    
    const handleRefresh = () => {
        setRefreshing(true);
        loadStats();
    };
    
    const handleGiftCredits = () => {
        setShowGiftPanel(true);
        setShowRequestsPanel(false);
        setShowUsersPanel(false);
    };
    
    const handleServiceRequests = () => {
        setShowRequestsPanel(true);
        setShowGiftPanel(false);
        setShowUsersPanel(false);
    };
    
    const handleViewUsers = () => {
        setShowUsersPanel(true);
        setShowGiftPanel(false);
        setShowRequestsPanel(false);
    };
    
    if (loading) {
        return (
            <View style={adminStyles.container}>
                <View style={adminStyles.loadingContainer}>
                    <ActivityIndicator size="large" color="#E67E22" />
                </View>
            </View>
        );
    }
    
    return (
        <View style={adminStyles.container}>
            <View style={adminStyles.header}>
                <Text style={adminStyles.headerTitle}>Admin Dashboard</Text>
                <TouchableOpacity onPress={handleRefresh}>
                    <Text style={adminStyles.refreshIcon}>🔄</Text>
                </TouchableOpacity>
            </View>
            
            <ScrollView
                contentContainerStyle={adminStyles.content}
                refreshControl={
                    <RefreshControl 
                        refreshing={refreshing} 
                        onRefresh={handleRefresh}
                        colors={['#E67E22']}
                        tintColor="#E67E22"
                    />
                }
            >
                <Text style={adminStyles.sectionTitle}>📊 Dashboard Overview</Text>
                
                <View style={adminStyles.statsGrid}>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.totalUsers || 0}</Text>
                        <Text style={adminStyles.statLabel}>Total Users</Text>
                    </View>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.totalGigs || 0}</Text>
                        <Text style={adminStyles.statLabel}>Total Gigs</Text>
                    </View>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.totalCreditsPurchased || 0}</Text>
                        <Text style={adminStyles.statLabel}>Credits Sold</Text>
                    </View>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>₦{(stats?.totalRevenue || 0).toLocaleString()}</Text>
                        <Text style={adminStyles.statLabel}>Revenue</Text>
                    </View>
                </View>
                
                <Text style={[adminStyles.sectionTitle, { marginTop: 24 }]}>📈 User Growth</Text>
                
                <View style={adminStyles.statsGrid}>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.usersJoinedToday || 0}</Text>
                        <Text style={adminStyles.statLabel}>Joined Today</Text>
                    </View>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.usersJoinedWeek || 0}</Text>
                        <Text style={adminStyles.statLabel}>This Week</Text>
                    </View>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.usersJoinedMonth || 0}</Text>
                        <Text style={adminStyles.statLabel}>This Month</Text>
                    </View>
                    <View style={adminStyles.statCard}>
                        <Text style={adminStyles.statValue}>{stats?.usersJoinedYear || 0}</Text>
                        <Text style={adminStyles.statLabel}>This Year</Text>
                    </View>
                </View>
                
                <Text style={[adminStyles.sectionTitle, { marginTop: 24 }]}>⚡ Quick Actions</Text>
                
                <View style={adminStyles.actionsContainer}>
                    <TouchableOpacity style={adminStyles.actionButton} onPress={handleGiftCredits}>
                        <Text style={adminStyles.actionButtonText}>🎁 Gift Credits</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={adminStyles.secondaryButton} onPress={handleServiceRequests}>
                        <Text style={adminStyles.secondaryButtonText}>
                            📋 Service Requests ({stats?.pendingRequests || 0})
                        </Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity style={adminStyles.secondaryButton} onPress={handleViewUsers}>
                        <Text style={adminStyles.secondaryButtonText}>👥 View Users</Text>
                    </TouchableOpacity>
                </View>
                
                {showGiftPanel && <GiftCreditsPanel onClose={() => setShowGiftPanel(false)} />}
                {showRequestsPanel && <ServiceRequestsPanel onClose={() => setShowRequestsPanel(false)} />}
                {showUsersPanel && <UsersListPanel onClose={() => setShowUsersPanel(false)} />}
                
            </ScrollView>
        </View>
    );
}

// ========================================
// ADMIN PANEL COMPONENTS
// ========================================

function GiftCreditsPanel({ onClose }) {
    const [email, setEmail] = useState('');
    const [credits, setCredits] = useState('5');
    const [foundUser, setFoundUser] = useState(null);
    const [looking, setLooking] = useState(false);
    const [sending, setSending] = useState(false);
    
    const handleLookup = async () => {
        if (!email.trim()) {
            global.showToast('Please enter an email', 'error');
            return;
        }
        
        setLooking(true);
        setFoundUser(null);
        
        try {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', email.trim()), limit(1));
            const snapshot = await getDocs(q);
            
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                setFoundUser({
                    id: doc.id,
                    ...doc.data()
                });
            } else {
                global.showToast('User not found', 'error');
            }
        } catch (error) {
            global.showToast('Error looking up user', 'error');
        } finally {
            setLooking(false);
        }
    };
    
    const handleSend = async () => {
        if (!foundUser || !credits) return;
        
        const creditAmount = parseInt(credits);
        if (creditAmount < 1) {
            global.showToast('Enter valid credits', 'error');
            return;
        }
        
        setSending(true);
        
        try {
            const userRef = doc(db, 'users', foundUser.id);
            const newCredits = (foundUser.credits || 0) + creditAmount;
            
            await updateDoc(userRef, {
                credits: newCredits,
                updatedAt: new Date().toISOString()
            });
            
            const transactionsRef = collection(db, 'transactions');
            await addDoc(transactionsRef, {
                userId: foundUser.id,
                type: 'admin_gift',
                credits: creditAmount,
                amount: 0,
                reference: 'admin_' + Date.now(),
                createdAt: new Date().toISOString()
            });
            
            await addNotification(
                foundUser.id,
                '🎁 Free Credits!',
                `You received ${creditAmount} free credits from GigsCourt!`
            );
            
            global.showToast(`Sent ${creditAmount} credits!`, 'success');
            haptic('success');
            onClose();
            
        } catch (error) {
            global.showToast('Error sending credits', 'error');
        } finally {
            setSending(false);
        }
    };
    
    return (
        <View style={adminStyles.panel}>
            <Text style={adminStyles.panelTitle}>🎁 Gift Credits</Text>
            
            <TextInput
                style={adminStyles.input}
                placeholder="User Email Address"
                placeholderTextColor="#8e8e8e"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
            />
            
            <TouchableOpacity 
                style={adminStyles.lookupButton}
                onPress={handleLookup}
                disabled={looking}
            >
                {looking ? (
                    <ActivityIndicator size="small" color="#fff" />
                ) : (
                    <Text style={adminStyles.lookupButtonText}>🔍 Lookup User</Text>
                )}
            </TouchableOpacity>
            
            {foundUser && (
                <View style={adminStyles.userInfo}>
                    <Text style={adminStyles.userInfoText}>
                        ✅ {foundUser.displayName || 'User'}
                    </Text>
                    <Text style={adminStyles.userInfoSubtext}>
                        Current Credits: {foundUser.credits || 0}
                    </Text>
                </View>
            )}
            
            <TextInput
                style={adminStyles.input}
                placeholder="Credits Amount"
                placeholderTextColor="#8e8e8e"
                value={credits}
                onChangeText={setCredits}
                keyboardType="number-pad"
            />
            
            <TouchableOpacity 
                style={[adminStyles.sendButton, !foundUser && adminStyles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!foundUser || sending}
            >
                {sending ? (
                    <ActivityIndicator size="small" color="#fff" />
                ) : (
                    <Text style={adminStyles.sendButtonText}>Send Credits</Text>
                )}
            </TouchableOpacity>
            
            <TouchableOpacity onPress={onClose}>
                <Text style={adminStyles.closeText}>Close</Text>
            </TouchableOpacity>
        </View>
    );
}

function ServiceRequestsPanel({ onClose }) {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        loadRequests();
    }, []);
    
    const loadRequests = async () => {
        try {
            const { data, error } = await supabase
                .from('service_requests')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            setRequests(data || []);
        } catch (error) {
            console.error('Load requests error:', error);
        } finally {
            setLoading(false);
        }
    };
    
    const handleProcess = async (requestId, action, editedName = null) => {
        try {
            const { data, error } = await supabase.rpc('admin_process_service_request', {
                p_request_id: requestId,
                p_action: action,
                p_edited_name: editedName
            });
            
            if (error) throw error;
            
            if (data.success) {
                global.showToast(`Request ${action}ed!`, 'success');
                loadRequests();
            }
        } catch (error) {
            global.showToast('Error processing request', 'error');
        }
    };
    
    if (loading) {
        return (
            <View style={adminStyles.panel}>
                <ActivityIndicator size="large" color="#E67E22" />
            </View>
        );
    }
    
    return (
        <View style={adminStyles.panel}>
            <Text style={adminStyles.panelTitle}>📋 Service Requests ({requests.length})</Text>
            
            <ScrollView style={adminStyles.requestsList}>
                {requests.length === 0 ? (
                    <Text style={adminStyles.emptyText}>No pending requests</Text>
                ) : (
                    requests.map(req => (
                        <View key={req.id} style={adminStyles.requestItem}>
                            <Text style={adminStyles.requestService}>{req.requested_service}</Text>
                            <Text style={adminStyles.requestEmail}>{req.user_email || req.user_id}</Text>
                            
                            <View style={adminStyles.requestActions}>
                                <TouchableOpacity 
                                    style={adminStyles.approveButton}
                                    onPress={() => handleProcess(req.id, 'approve', req.requested_service)}
                                >
                                    <Text style={adminStyles.approveText}>✅ Approve</Text>
                                </TouchableOpacity>
                                
                                <TouchableOpacity 
                                    style={adminStyles.rejectButton}
                                    onPress={() => handleProcess(req.id, 'reject')}
                                >
                                    <Text style={adminStyles.rejectText}>❌ Reject</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>
            
            <TouchableOpacity onPress={onClose}>
                <Text style={adminStyles.closeText}>Close</Text>
            </TouchableOpacity>
        </View>
    );
}

function UsersListPanel({ onClose }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        loadUsers();
    }, []);
    
    const loadUsers = async () => {
        try {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, orderBy('createdAt', 'desc'), limit(50));
            const snapshot = await getDocs(q);
            
            const usersList = [];
            snapshot.forEach(doc => {
                usersList.push({ id: doc.id, ...doc.data() });
            });
            
            setUsers(usersList);
        } catch (error) {
            console.error('Load users error:', error);
        } finally {
            setLoading(false);
        }
    };
    
    if (loading) {
        return (
            <View style={adminStyles.panel}>
                <ActivityIndicator size="large" color="#E67E22" />
            </View>
        );
    }
    
    return (
        <View style={adminStyles.panel}>
            <Text style={adminStyles.panelTitle}>👥 Users ({users.length})</Text>
            
            <ScrollView style={adminStyles.usersList}>
                {users.map(user => (
                    <View key={user.id} style={adminStyles.userItem}>
                        <Text style={adminStyles.userName}>{user.displayName || 'Anonymous'}</Text>
                        <Text style={adminStyles.userEmail}>📧 {user.email || 'No email'}</Text>
                        
                        <View style={adminStyles.userStats}>
                            <Text style={adminStyles.userStat}>💰 {user.credits || 0} credits</Text>
                            <Text style={adminStyles.userStat}>📊 {user.gigCount || 0} gigs</Text>
                            <Text style={adminStyles.userStat}>⭐ {(user.rating || 0).toFixed(1)}</Text>
                        </View>
                        
                        <Text style={adminStyles.userJoined}>
                            📅 Joined: {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                        </Text>
                    </View>
                ))}
            </ScrollView>
            
            <TouchableOpacity onPress={onClose}>
                <Text style={adminStyles.closeText}>Close</Text>
            </TouchableOpacity>
        </View>
    );
}

// ========== ADMIN STYLES ==========
const adminStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingBottom: 10,
        backgroundColor: '#0f0f0f',
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2c',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#f5f5f5',
    },
    refreshIcon: {
        fontSize: 24,
    },
    content: {
        padding: 16,
        paddingBottom: 30,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#f5f5f5',
        marginBottom: 16,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    statCard: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    statValue: {
        fontSize: 28,
        fontWeight: '700',
        color: '#E67E22',
    },
    statLabel: {
        fontSize: 13,
        color: '#8e8e8e',
        marginTop: 4,
    },
    actionsContainer: {
        gap: 12,
    },
    actionButton: {
        backgroundColor: '#E67E22',
        borderRadius: 30,
        paddingVertical: 16,
        alignItems: 'center',
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    secondaryButton: {
        backgroundColor: '#1a1a1a',
        borderRadius: 30,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    secondaryButtonText: {
        color: '#f5f5f5',
        fontSize: 15,
        fontWeight: '500',
    },
    panel: {
        marginTop: 20,
        padding: 16,
        backgroundColor: '#1a1a1a',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#2c2c2c',
    },
    panelTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#f5f5f5',
        marginBottom: 16,
    },
    input: {
        backgroundColor: '#0f0f0f',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#f5f5f5',
        borderWidth: 1,
        borderColor: '#2c2c2c',
        marginBottom: 12,
    },
    lookupButton: {
        backgroundColor: '#E67E22',
        borderRadius: 30,
        paddingVertical: 12,
        alignItems: 'center',
        marginBottom: 12,
    },
    lookupButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    userInfo: {
        backgroundColor: '#0f0f0f',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
    },
    userInfoText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#f5f5f5',
    },
    userInfoSubtext: {
        fontSize: 13,
        color: '#8e8e8e',
        marginTop: 4,
    },
    sendButton: {
        backgroundColor: '#4caf50',
        borderRadius: 30,
        paddingVertical: 14,
        alignItems: 'center',
        marginBottom: 12,
    },
    sendButtonDisabled: {
        opacity: 0.5,
    },
    sendButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    closeText: {
        fontSize: 14,
        color: '#E67E22',
        textAlign: 'center',
        marginTop: 8,
    },
    requestsList: {
        maxHeight: 350,
    },
    requestItem: {
        padding: 12,
        backgroundColor: '#0f0f0f',
        borderRadius: 12,
        marginBottom: 10,
    },
    requestService: {
        fontSize: 15,
        fontWeight: '600',
        color: '#f5f5f5',
        marginBottom: 4,
    },
    requestEmail: {
        fontSize: 13,
        color: '#8e8e8e',
        marginBottom: 12,
    },
    requestActions: {
        flexDirection: 'row',
        gap: 8,
    },
    approveButton: {
        flex: 1,
        backgroundColor: '#4caf50',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    approveText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    rejectButton: {
        flex: 1,
        backgroundColor: '#ea4335',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    rejectText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    emptyText: {
        fontSize: 14,
        color: '#8e8e8e',
        textAlign: 'center',
        paddingVertical: 20,
    },
    usersList: {
        maxHeight: 350,
    },
    userItem: {
        padding: 12,
        backgroundColor: '#0f0f0f',
        borderRadius: 12,
        marginBottom: 10,
    },
    userName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#f5f5f5',
        marginBottom: 4,
    },
    userEmail: {
        fontSize: 13,
        color: '#8e8e8e',
        marginBottom: 8,
    },
    userStats: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 8,
    },
    userStat: {
        fontSize: 13,
        color: '#f5f5f5',
    },
    userJoined: {
        fontSize: 12,
        color: '#6c6c6c',
    },
});

// ========================================
// FINAL EXPORTS AND GLOBAL SETUP
// ========================================

// Export all screens for App.js
export {
    HomeScreen,
    SearchScreen,
    ChatsScreen,
    ProfileScreen,
    ChatScreen,
    AdminScreen
};

// Make functions globally available
global.loadHomeFeed = async () => {};
global.loadProfile = async (userId) => {
    const userRef = doc(db, 'users', userId || auth.currentUser?.uid);
    const userSnap = await getDoc(userRef);
    return userSnap.exists() ? userSnap.data() : null;
};
global.buyCredits = () => {};
global.showSettings = () => {};
global.showRecentChatsForGig = showRecentChatsForGig;
global.registerGig = registerGig;
global.submitReview = submitReview;
global.cancelGig = cancelGig;
global.checkGigStatusAndUpdateUI = checkGigStatusAndUpdateUI;
global.showReviewBottomSheet = showReviewBottomSheet;
global.showReviews = showReviews;
global.recalculateStaleCounters = recalculateStaleCounters;
global.formatDistance = formatDistance;
global.getCachedProvider = getCachedProvider;
global.setCachedProvider = setCachedProvider;

console.log('✅ app-features.js fully loaded - All screens exported');
