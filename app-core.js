// ========================================
// GigsCourt - Core Module (React Native)
// Authentication, Navigation, UI, Onboarding
// ========================================

import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Image,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Dimensions,
    Modal,
    Animated
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    sendPasswordResetEmail,
    sendEmailVerification
} from 'firebase/auth';
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    collection,
    addDoc,
    query,
    where,
    getDocs,
    orderBy,
    writeBatch,
    limit,
    increment,
    onSnapshot,
    enableIndexedDbPersistence,
    deleteDoc
} from 'firebase/firestore';
import { createClient } from '@supabase/supabase-js';
import { firebaseConfig } from './firebase-config';

// Supabase configuration
const supabaseUrl = 'https://qifzdrkpxzosdturjpex.supabase.co';
const supabaseAnonKey = 'sb_publishable_QfKJ4jT8u_2HuUKmW-xvbQ_9acJvZw-';

// ========== FIREBASE INITIALIZATION ==========
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Initialize Supabase
let supabase = null;

// Global state
let currentUser = null;
let currentUserData = null;
let messaging = null;
let navigationHistory = [];
let currentViewedUserId = null;

// Context for auth state
export const AuthContext = createContext(null);

// ========== PRESET SERVICES (30) ==========
export const PRESET_SERVICES = [
    "Tailoring / fashion design", "Barbing (men's haircutting)", "Hairdressing (braiding, wigs, styling)",
    "Makeup artistry", "Shoe making / cobbling", "Phone repairs (hardware/software)",
    "Computer repairs", "Electrical installation (wiring, fittings)", "Plumbing",
    "Carpentry / furniture making", "Masonry / bricklaying", "Welding / metal fabrication",
    "Tiling (floor/wall)", "POP ceiling installation", "Painting (house painting)",
    "Auto mechanic (car repair)", "Motorcycle/tricycle repair", "Catering (event cooking)",
    "Baking (cakes, pastries)", "Event decoration", "CCTV installation",
    "Solar panel installation", "Generator repair", "AC (air conditioner) repair",
    "Aluminum work (windows/doors)", "Interior decoration (home setup)",
    "Laundry / dry cleaning service", "Upholstery (sofa/seat making & repair)",
    "Printing & branding (flex, banners, T-shirts)", "POP screeding / wall finishing"
];

// ========== HAPTIC FEEDBACK ==========
export function haptic(type = 'light') {
    if (type === 'light') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (type === 'medium') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else if (type === 'heavy') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else if (type === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (type === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
}

// ========== FORMAT RELATIVE TIME ==========
export function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    const diffWeek = Math.floor(diffDay / 7);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);
    
    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHr < 24) return `${diffHr} hr ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay} days ago`;
    if (diffWeek === 1) return '1 week ago';
    if (diffWeek < 4) return `${diffWeek} weeks ago`;
    if (diffMonth === 1) return '1 month ago';
    if (diffMonth < 12) return `${diffMonth} months ago`;
    if (diffYear === 1) return '1 year ago';
    return `${diffYear} years ago`;
}

// ========== IMAGE OPTIMIZATION HELPER ==========
export function getOptimizedImageUrl(url, width = 100, height = 100, fullSize = false) {
    if (!url) return 'https://ui-avatars.com/api/?name=User';
    
    if (url.includes('ui-avatars.com')) return url;
    
    const cacheParam = 'cache-control=public,max-age=31536000';
    
    if (fullSize) {
        return `${url}?tr=f-webp,${cacheParam}`;
    }
    
    return `${url}?tr=f-webp,w-${width},h-${height},c-at_max,${cacheParam}`;
}

// ========== INITIALIZE CORE ==========
export async function initializeAppCore() {
    // Initialize Supabase with auth token
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => {
            const user = auth.currentUser;
            if (user) {
                return await user.getIdToken(false);
            }
            return null;
        }
    });
    
    // Make available globally
    global.auth = auth;
    global.db = db;
    global.supabase = supabase;
    global.haptic = haptic;
    
    // Setup notification handlers
    setupNotifications();
    
    console.log('✅ Core initialized');
}

// ========== NOTIFICATION SETUP ==========
async function setupNotifications() {
    if (!Device.isDevice) {
        console.log('Notifications require physical device');
        return;
    }
    
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
        console.log('Notification permission denied');
        return;
    }
    
    // Get FCM token
    try {
        const token = (await Notifications.getExpoPushTokenAsync({
            projectId: '505136313803' // Your Firebase project ID
        })).data;
        
        console.log('Expo push token:', token);
        
        if (currentUser) {
            // Save token to Firestore
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, {
                fcmToken: token,
                fcmTokenUpdated: new Date().toISOString()
            }).catch(() => {});
        }
    } catch (error) {
        console.error('Error getting push token:', error);
    }
}

// ========== GET AUTH STATE ==========
export async function getAuthState() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            currentUser = user;
            unsubscribe();
            resolve({ user });
        });
    });
}

// ========== GET CURRENT USER ==========
export function getCurrentUser() {
    return currentUser;
}

// ========== GET CURRENT USER DATA ==========
export function getCurrentUserData() {
    return currentUserData;
}

// ========== SET CURRENT USER DATA ==========
export function setCurrentUserData(data) {
    currentUserData = data;
}

// ========== PUSH TO NAVIGATION HISTORY ==========
export function pushToHistory(page, scrollY = 0, viewedUserId = null) {
    navigationHistory.push({ page, scrollY, viewedUserId });
}

// ========== GO BACK ==========
export function goBack(navigation) {
    if (navigationHistory.length === 0) {
        navigation.navigate('Home');
        return;
    }
    
    const previous = navigationHistory.pop();
    navigation.navigate(previous.page);
    
    if (previous.viewedUserId) {
        currentViewedUserId = previous.viewedUserId;
    } else {
        currentViewedUserId = null;
    }
}

// ========== UPLOAD IMAGE (ImageKit) ==========
export async function uploadImage(fileUri, folder = 'profiles') {
    try {
        // Fetch auth params from your Vercel API
        const response = await fetch('https://gigscourt.vercel.app/api/imagekit-auth');
        const authParams = await response.json();
        
        // Create form data
        const formData = new FormData();
        
        // Append file
        const filename = fileUri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        
        formData.append('file', {
            uri: fileUri,
            name: `${Date.now()}_${filename}`,
            type
        });
        formData.append('fileName', `${Date.now()}_${filename}`);
        formData.append('folder', `/GigsCourt/${folder}`);
        formData.append('useUniqueFileName', 'true');
        formData.append('publicKey', authParams.publicKey);
        formData.append('signature', authParams.signature);
        formData.append('token', authParams.token);
        formData.append('expire', authParams.expire);
        
        const uploadResponse = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
            method: 'POST',
            body: formData,
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        
        const data = await uploadResponse.json();
        
        if (data.url) {
            return data.url;
        } else {
            console.error('Upload error:', data);
            return null;
        }
    } catch (error) {
        console.error('uploadImage error:', error);
        return null;
    }
}

// ========== SEND PUSH NOTIFICATION ==========
export async function sendPushNotification(userId, title, body, clickAction = '/') {
    if (!userId) return;
    
    try {
        await fetch('https://gigscourt.vercel.app/api/send-notification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId,
                title,
                body,
                clickAction
            })
        });
    } catch (error) {
        console.error('Failed to send notification:', error);
    }
}

// ========== NOTIFICATION FUNCTIONS ==========
export async function addNotification(userId, title, body, link = '') {
    if (!userId) return;
    
    try {
        const notificationRef = collection(db, 'users', userId, 'notifications');
        await addDoc(notificationRef, {
            title,
            body,
            link,
            read: false,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        
        // Increment unread count
        const metaRef = doc(db, 'user_notification_meta', userId);
        await updateDoc(metaRef, {
            unreadCount: increment(1)
        }).catch(async (err) => {
            if (err.code === 'not-found') {
                await setDoc(metaRef, { unreadCount: 1 });
            }
        });
    } catch (error) {
        console.error('Failed to add notification:', error);
    }
}

// Make globally available
global.uploadImage = uploadImage;
global.sendPushNotification = sendPushNotification;
global.addNotification = addNotification;
global.formatRelativeTime = formatRelativeTime;
global.getOptimizedImageUrl = getOptimizedImageUrl;
global.PRESET_SERVICES = PRESET_SERVICES;
global.currentUserData = null;
global.currentViewedUserId = null;

console.log('✅ app-core.js Part 1 loaded');

// ========================================
// AUTH SCREEN COMPONENT
// ========================================

export function AuthScreen({ navigation }) {
    const [mode, setMode] = useState('login'); // 'login' or 'signup'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        if (!email || !password) {
            global.showToast('Please enter email and password', 'error');
            return;
        }
        
        setLoading(true);
        try {
            const userCred = await signInWithEmailAndPassword(auth, email, password);
            currentUser = userCred.user;
            
            // Fetch user profile from Firestore
            const userRef = doc(db, 'users', userCred.user.uid);
            const userSnap = await getDoc(userRef);
            
            if (userSnap.exists()) {
                currentUserData = userSnap.data();
                global.currentUserData = currentUserData;
            }
            
            global.showToast('Welcome back!', 'success');
            haptic('success');
            
            // Navigation will be handled by App.js auth state listener
        } catch (error) {
            console.error('Login error:', error);
            if (error.code === 'auth/user-not-found') {
                global.showToast('No account found with this email', 'error');
            } else if (error.code === 'auth/wrong-password') {
                global.showToast('Incorrect password', 'error');
            } else if (error.code === 'auth/invalid-email') {
                global.showToast('Invalid email address', 'error');
            } else {
                global.showToast(error.message, 'error');
            }
            haptic('error');
        } finally {
            setLoading(false);
        }
    };

    const handleSignup = async () => {
        if (!email) {
            global.showToast('Please enter your email', 'error');
            return;
        }
        if (!password) {
            global.showToast('Please enter a password', 'error');
            return;
        }
        if (password.length < 6) {
            global.showToast('Password must be at least 6 characters', 'error');
            return;
        }
        if (password !== confirmPassword) {
            global.showToast('Passwords do not match', 'error');
            return;
        }
        
        setLoading(true);
        try {
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            currentUser = userCred.user;
            
            // Send email verification
            await sendEmailVerification(userCred.user);
            
            // Create initial Firestore profile
            const userRef = doc(db, 'users', userCred.user.uid);
            await setDoc(userRef, {
                displayName: '',
                email: email,
                phone: '',
                bio: '',
                addressText: '',
                services: [],
                photoURL: null,
                portfolio: [],
                credits: 5,
                gigCount: 0,
                rating: 0,
                totalRatingSum: 0,
                reviewCount: 0,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            
            global.showToast('Account created! Check your email to verify.', 'success');
            haptic('success');
            
            // Navigate to verification screen
            navigation.replace('Verification');
        } catch (error) {
            console.error('Signup error:', error);
            if (error.code === 'auth/email-already-in-use') {
                global.showToast('Email already in use. Please login.', 'error');
            } else if (error.code === 'auth/invalid-email') {
                global.showToast('Invalid email address', 'error');
            } else {
                global.showToast(error.message, 'error');
            }
            haptic('error');
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email) {
            global.showToast('Enter your email address first', 'error');
            return;
        }
        
        try {
            await sendPasswordResetEmail(auth, email);
            global.showToast('Password reset email sent! Check your inbox.', 'success');
            haptic('success');
        } catch (error) {
            console.error('Reset error:', error);
            if (error.code === 'auth/user-not-found') {
                global.showToast('No account found with this email', 'error');
            } else {
                global.showToast(error.message, 'error');
            }
            haptic('error');
        }
    };

    return (
        <KeyboardAvoidingView 
            style={authStyles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView 
                contentContainerStyle={authStyles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                <View style={authStyles.logoContainer}>
                    <Text style={authStyles.logo}>
                        <Text style={authStyles.logoGigs}>Gigs</Text>
                        <Text style={authStyles.logoCourt}>Court</Text>
                    </Text>
                    <Text style={authStyles.subtitle}>
                        {mode === 'login' ? 'Welcome Back' : 'Create Account'}
                    </Text>
                    <Text style={authStyles.subtitleSmall}>
                        {mode === 'login' ? 'Sign in to continue' : 'Join the community'}
                    </Text>
                </View>

                <View style={authStyles.tabContainer}>
                    <TouchableOpacity 
                        style={[authStyles.tab, mode === 'login' && authStyles.activeTab]}
                        onPress={() => setMode('login')}
                    >
                        <Text style={[authStyles.tabText, mode === 'login' && authStyles.activeTabText]}>
                            Login
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[authStyles.tab, mode === 'signup' && authStyles.activeTab]}
                        onPress={() => setMode('signup')}
                    >
                        <Text style={[authStyles.tabText, mode === 'signup' && authStyles.activeTabText]}>
                            Sign Up
                        </Text>
                    </TouchableOpacity>
                </View>

                <View style={authStyles.form}>
                    <TextInput
                        style={authStyles.input}
                        placeholder="Email"
                        placeholderTextColor="#8e8e8e"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        editable={!loading}
                    />
                    
                    <TextInput
                        style={authStyles.input}
                        placeholder="Password"
                        placeholderTextColor="#8e8e8e"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        editable={!loading}
                    />
                    
                    {mode === 'signup' && (
                        <TextInput
                            style={authStyles.input}
                            placeholder="Confirm Password"
                            placeholderTextColor="#8e8e8e"
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            secureTextEntry
                            editable={!loading}
                        />
                    )}
                    
                    <TouchableOpacity 
                        style={authStyles.primaryButton}
                        onPress={mode === 'login' ? handleLogin : handleSignup}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={authStyles.primaryButtonText}>
                                {mode === 'login' ? 'Login' : 'Create Account'}
                            </Text>
                        )}
                    </TouchableOpacity>
                    
                    {mode === 'login' && (
                        <TouchableOpacity 
                            style={authStyles.linkButton}
                            onPress={handleForgotPassword}
                        >
                            <Text style={authStyles.linkText}>Forgot Password?</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// ========================================
// EMAIL VERIFICATION SCREEN
// ========================================

export function VerificationScreen({ navigation }) {
    const [checking, setChecking] = useState(false);
    const [email, setEmail] = useState('');
    
    useEffect(() => {
        if (currentUser) {
            setEmail(currentUser.email || '');
        }
        
        // Check verification status periodically
        const interval = setInterval(async () => {
            if (currentUser) {
                await currentUser.reload();
                if (currentUser.emailVerified) {
                    clearInterval(interval);
                    // Check if profile is complete
                    const userRef = doc(db, 'users', currentUser.uid);
                    const userSnap = await getDoc(userRef);
                    const userData = userSnap.data();
                    
                    if (userData?.displayName && userData.displayName !== 'User') {
                        navigation.replace('Main');
                    } else {
                        navigation.replace('Onboarding');
                    }
                }
            }
        }, 3000);
        
        return () => clearInterval(interval);
    }, []);
    
    const handleResend = async () => {
        if (!currentUser) return;
        
        setChecking(true);
        try {
            await sendEmailVerification(currentUser);
            global.showToast('Verification email resent! Check your inbox.', 'success');
            haptic('success');
        } catch (error) {
            global.showToast('Error sending verification email', 'error');
        } finally {
            setChecking(false);
        }
    };
    
    const handleLogout = async () => {
        await signOut(auth);
        currentUser = null;
        currentUserData = null;
        navigation.replace('Auth');
    };
    
    return (
        <View style={verificationStyles.container}>
            <View style={verificationStyles.card}>
                <Text style={verificationStyles.logo}>
                    <Text style={verificationStyles.logoGigs}>Gigs</Text>
                    <Text style={verificationStyles.logoCourt}>Court</Text>
                </Text>
                <Text style={verificationStyles.title}>Verify Your Email</Text>
                <Text style={verificationStyles.subtitle}>
                    We've sent a verification email to
                </Text>
                <Text style={verificationStyles.email}>{email}</Text>
                <Text style={verificationStyles.instruction}>
                    Please check your inbox and click the verification link.
                </Text>
                
                <TouchableOpacity 
                    style={verificationStyles.primaryButton}
                    onPress={handleResend}
                    disabled={checking}
                >
                    {checking ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={verificationStyles.primaryButtonText}>Resend Email</Text>
                    )}
                </TouchableOpacity>
                
                <TouchableOpacity 
                    style={verificationStyles.secondaryButton}
                    onPress={handleLogout}
                >
                    <Text style={verificationStyles.secondaryButtonText}>Back to Login</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

// ========================================
// ONBOARDING SCREEN (5 Steps)
// ========================================

export function OnboardingScreen({ navigation }) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    
    // Form data
    const [displayName, setDisplayName] = useState('');
    const [phone, setPhone] = useState('');
    const [selectedServices, setSelectedServices] = useState([]);
    const [addressText, setAddressText] = useState('');
    const [location, setLocation] = useState(null);
    const [bio, setBio] = useState('');
    const [photoURL, setPhotoURL] = useState(null);
    
    // Services data
    const [categories, setCategories] = useState([]);
    const [services, setServices] = useState([]);
    const [expandedCategories, setExpandedCategories] = useState({});
    
    useEffect(() => {
        if (step === 2) {
            fetchServices();
        }
        if (step === 3) {
            getCurrentLocation();
        }
    }, [step]);
    
    const fetchServices = async () => {
        try {
            const { data: catData } = await supabase
                .from('service_categories')
                .select('*')
                .order('display_order', { ascending: true });
            
            const { data: servData } = await supabase
                .from('preset_services')
                .select('*')
                .eq('is_active', true);
            
            setCategories(catData || []);
            setServices(servData || []);
        } catch (error) {
            console.error('Error fetching services:', error);
        }
    };
    
    const getCurrentLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
                const loc = await Location.getCurrentPositionAsync({});
                setLocation({
                    lat: loc.coords.latitude,
                    lng: loc.coords.longitude
                });
            }
        } catch (error) {
            console.error('Location error:', error);
        }
    };
    
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
    
    const handleNext = () => {
        if (step === 1) {
            if (!displayName.trim()) {
                global.showToast('Please enter your full name', 'error');
                return;
            }
            setStep(2);
        } else if (step === 2) {
            if (selectedServices.length === 0) {
                global.showToast('Please select at least one service', 'error');
                return;
            }
            setStep(3);
        } else if (step === 3) {
            setStep(4);
        } else if (step === 4) {
            setStep(5);
        } else if (step === 5) {
            handleComplete();
        }
    };
    
    const handleBack = () => {
        if (step > 1) {
            setStep(step - 1);
        }
    };
    
    const handleComplete = async () => {
        if (!currentUser) return;
        
        setLoading(true);
        try {
            // Upload photo if selected
            let uploadedPhotoURL = null;
            if (photoURL) {
                uploadedPhotoURL = await uploadImage(photoURL, 'profiles');
            }
            
            const userId = currentUser.uid;
            
            // Save to Firestore
            const userRef = doc(db, 'users', userId);
            await updateDoc(userRef, {
                displayName: displayName || 'User',
                phone: phone || '',
                bio: bio || '',
                addressText: addressText || '',
                services: selectedServices,
                photoURL: uploadedPhotoURL || null,
                updatedAt: new Date().toISOString()
            });
            
            // Save location to Supabase
            if (location) {
                const servicesString = selectedServices.join(', ');
                await supabase
                    .from('provider_locations')
                    .upsert({
                        user_id: userId,
                        lat: location.lat,
                        lng: location.lng,
                        location: `POINT(${location.lng} ${location.lat})`,
                        services: servicesString,
                        rating: 0,
                        gig_count: 0
                    }, { onConflict: 'user_id' });
            }
            
            // Update current user data
            const userSnap = await getDoc(userRef);
            currentUserData = userSnap.data();
            global.currentUserData = currentUserData;
            
            global.showToast('Welcome to GigsCourt! 🎉', 'success');
            haptic('success');
            
            navigation.replace('Main');
        } catch (error) {
            console.error('Onboarding error:', error);
            global.showToast('Error saving profile', 'error');
        } finally {
            setLoading(false);
        }
    };
    
    const toggleService = (serviceName) => {
        if (selectedServices.includes(serviceName)) {
            setSelectedServices(selectedServices.filter(s => s !== serviceName));
        } else {
            setSelectedServices([...selectedServices, serviceName]);
        }
    };
    
    const toggleCategory = (categoryId) => {
        setExpandedCategories({
            ...expandedCategories,
            [categoryId]: !expandedCategories[categoryId]
        });
    };
    
    const renderStep = () => {
        switch (step) {
            case 1:
                return (
                    <View style={onboardingStyles.stepContainer}>
                        <Text style={onboardingStyles.title}>Welcome to GigsCourt! 👋</Text>
                        <Text style={onboardingStyles.subtitle}>Let's set up your profile</Text>
                        
                        <TextInput
                            style={onboardingStyles.input}
                            placeholder="Full name"
                            placeholderTextColor="#8e8e8e"
                            value={displayName}
                            onChangeText={setDisplayName}
                        />
                        
                        <TextInput
                            style={onboardingStyles.input}
                            placeholder="Phone number (optional)"
                            placeholderTextColor="#8e8e8e"
                            value={phone}
                            onChangeText={setPhone}
                            keyboardType="phone-pad"
                        />
                    </View>
                );
                
            case 2:
                return (
                    <View style={onboardingStyles.stepContainer}>
                        <Text style={onboardingStyles.title}>What services do you offer?</Text>
                        <Text style={onboardingStyles.subtitle}>Select all that apply</Text>
                        
                        <ScrollView style={onboardingStyles.servicesContainer}>
                            {categories.map(cat => {
                                const catServices = services.filter(s => s.category_id === cat.id);
                                if (catServices.length === 0) return null;
                                
                                return (
                                    <View key={cat.id} style={onboardingStyles.categoryContainer}>
                                        <TouchableOpacity 
                                            style={onboardingStyles.categoryHeader}
                                            onPress={() => toggleCategory(cat.id)}
                                        >
                                            <Text style={onboardingStyles.categoryArrow}>
                                                {expandedCategories[cat.id] ? '▼' : '▶'}
                                            </Text>
                                            <Text style={onboardingStyles.categoryName}>
                                                {cat.emoji} {cat.category_name}
                                            </Text>
                                            <Text style={onboardingStyles.categoryCount}>
                                                {catServices.length}
                                            </Text>
                                        </TouchableOpacity>
                                        
                                        {expandedCategories[cat.id] && (
                                            <View style={onboardingStyles.servicesList}>
                                                {catServices.map(service => (
                                                    <TouchableOpacity
                                                        key={service.service_name}
                                                        style={[
                                                            onboardingStyles.serviceItem,
                                                            selectedServices.includes(service.service_name) && onboardingStyles.serviceItemSelected
                                                        ]}
                                                        onPress={() => toggleService(service.service_name)}
                                                    >
                                                        <Text style={[
                                                            onboardingStyles.serviceText,
                                                            selectedServices.includes(service.service_name) && onboardingStyles.serviceTextSelected
                                                        ]}>
                                                            {service.display_name}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </ScrollView>
                        
                        <Text style={onboardingStyles.selectedCount}>
                            {selectedServices.length} service{selectedServices.length !== 1 ? 's' : ''} selected
                        </Text>
                    </View>
                );
                
            case 3:
                return (
                    <View style={onboardingStyles.stepContainer}>
                        <Text style={onboardingStyles.title}>Where is your workspace?</Text>
                        <Text style={onboardingStyles.subtitle}>We'll use this to show you nearby clients</Text>
                        
                        <View style={onboardingStyles.locationPreview}>
                            <Text style={onboardingStyles.locationText}>
                                {location ? '📍 Location detected' : '⏳ Detecting location...'}
                            </Text>
                        </View>
                        
                        <TextInput
                            style={[onboardingStyles.input, onboardingStyles.textArea]}
                            placeholder="Describe your address (e.g., beside First Bank, Lagos)"
                            placeholderTextColor="#8e8e8e"
                            value={addressText}
                            onChangeText={setAddressText}
                            multiline
                            numberOfLines={3}
                        />
                        
                        <TouchableOpacity 
                            style={onboardingStyles.locationButton}
                            onPress={getCurrentLocation}
                        >
                            <Text style={onboardingStyles.locationButtonText}>
                                📍 Update Location
                            </Text>
                        </TouchableOpacity>
                    </View>
                );
                
            case 4:
                return (
                    <View style={onboardingStyles.stepContainer}>
                        <Text style={onboardingStyles.title}>How Credits Work 💰</Text>
                        
                        <View style={onboardingStyles.infoBox}>
                            <Text style={onboardingStyles.infoItem}>✅ 1 credit = 1 gig registration</Text>
                            <Text style={onboardingStyles.infoItem}>✅ Credits deducted ONLY after client reviews you</Text>
                            <Text style={onboardingStyles.infoItem}>✅ Buy credits: 5 for ₦2500 | 10 for ₦4500 | 20 for ₦8000</Text>
                            <Text style={onboardingStyles.infoItem}>✅ Without credits, you can still receive messages</Text>
                        </View>
                        
                        <Text style={onboardingStyles.freeCredits}>
                            You get 5 free credits to start! 🎁
                        </Text>
                    </View>
                );
                
            case 5:
                return (
                    <View style={onboardingStyles.stepContainer}>
                        <Text style={onboardingStyles.title}>Almost done!</Text>
                        <Text style={onboardingStyles.subtitle}>Add a profile photo</Text>
                        
                        <TouchableOpacity 
                            style={onboardingStyles.photoContainer}
                            onPress={handlePickPhoto}
                        >
                            {photoURL ? (
                                <Image source={{ uri: photoURL }} style={onboardingStyles.photo} />
                            ) : (
                                <Text style={onboardingStyles.photoPlaceholder}>📸</Text>
                            )}
                            <Text style={onboardingStyles.photoText}>
                                {photoURL ? 'Tap to change' : 'Tap to add photo'}
                            </Text>
                        </TouchableOpacity>
                        
                        <TextInput
                            style={[onboardingStyles.input, onboardingStyles.textArea]}
                            placeholder="Tell clients about yourself (optional)"
                            placeholderTextColor="#8e8e8e"
                            value={bio}
                            onChangeText={setBio}
                            multiline
                            numberOfLines={4}
                        />
                    </View>
                );
                
            default:
                return null;
        }
    };
    
    return (
        <View style={onboardingStyles.container}>
            <View style={onboardingStyles.header}>
                <TouchableOpacity onPress={() => navigation.replace('Auth')}>
                    <Text style={onboardingStyles.closeButton}>✕</Text>
                </TouchableOpacity>
                <Text style={onboardingStyles.stepIndicator}>
                    Step {step} of 5
                </Text>
                <View style={{ width: 32 }} />
            </View>
            
            <ScrollView 
                contentContainerStyle={onboardingStyles.content}
                keyboardShouldPersistTaps="handled"
            >
                {renderStep()}
            </ScrollView>
            
            <View style={onboardingStyles.footer}>
                {step > 1 && (
                    <TouchableOpacity 
                        style={onboardingStyles.secondaryButton}
                        onPress={handleBack}
                        disabled={loading}
                    >
                        <Text style={onboardingStyles.secondaryButtonText}>Back</Text>
                    </TouchableOpacity>
                )}
                
                <TouchableOpacity 
                    style={[
                        onboardingStyles.primaryButton,
                        step > 1 && onboardingStyles.primaryButtonWithBack
                    ]}
                    onPress={handleNext}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={onboardingStyles.primaryButtonText}>
                            {step === 5 ? 'Complete Setup' : 'Continue'}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

console.log('✅ app-core.js Part 2 loaded');
