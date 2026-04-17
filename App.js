// ========================================
// GigsCourt - React Native App Entry
// With Animated Video Splash Screen
// ========================================

import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Video, ResizeMode } from 'expo-av';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Import core module
import {
    initializeAppCore,
    getAuthState,
    getCurrentUser,
    getCurrentUserData,
    AuthScreen,
    OnboardingScreen,
    VerificationScreen,
    SettingsScreen
} from './app-core';

// Import feature screens
import {
    HomeScreen,
    SearchScreen,
    ChatsScreen,
    ProfileScreen,
    ChatScreen,
    AdminScreen
} from './app-features';

// Keep splash screen visible while we initialize
SplashScreen.preventAutoHideAsync();

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Configure notifications
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

// Custom Animated Splash Component
function AnimatedSplashScreen({ onFinish }) {
    const videoRef = useRef(null);
    const [videoLoaded, setVideoLoaded] = useState(false);
    const [videoError, setVideoError] = useState(false);

    useEffect(() => {
        // Hide the native splash screen once video is ready
        if (videoLoaded) {
            SplashScreen.hideAsync();
        }
    }, [videoLoaded]);

    const handleVideoReady = () => {
        setVideoLoaded(true);
    };

    const handleVideoError = (error) => {
        console.log('Video splash error, falling back to static:', error);
        setVideoError(true);
        // Fall back to static splash
        SplashScreen.hideAsync();
        setTimeout(onFinish, 500);
    };

    const handlePlaybackStatusUpdate = (status) => {
        if (status.didJustFinish) {
            // Video finished playing, transition to app
            onFinish();
        }
    };

    // If video errors, show nothing (static splash already handled)
    if (videoError) {
        return null;
    }

    return (
        <View style={splashStyles.container}>
            <Video
                ref={videoRef}
                source={require('./assets/splash.mp4')}
                style={splashStyles.video}
                resizeMode={ResizeMode.COVER}
                shouldPlay={true}
                isMuted={true}
                isLooping={false}
                onReadyForDisplay={handleVideoReady}
                onError={handleVideoError}
                onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
            />
        </View>
    );
}

// Bottom Tab Navigator
function MainTabs({ isAdmin, onOpenSettings }) {
    return (
        <Tab.Navigator
            screenOptions={{
                tabBarStyle: styles.tabBar,
                tabBarActiveTintColor: '#E67E22',
                tabBarInactiveTintColor: '#8e8e8e',
                tabBarLabelStyle: styles.tabBarLabel,
                headerShown: false,
            }}
        >
            <Tab.Screen 
                name="Home" 
                component={HomeScreen}
                options={{
                    tabBarIcon: ({ color }) => <Text style={{ fontSize: 24, color }}>🏠</Text>,
                }}
            />
            <Tab.Screen 
                name="Search" 
                component={SearchScreen}
                options={{
                    tabBarIcon: ({ color }) => <Text style={{ fontSize: 24, color }}>🔍</Text>,
                }}
            />
            <Tab.Screen 
                name="Chats" 
                component={ChatsScreen}
                options={{
                    tabBarIcon: ({ color }) => <Text style={{ fontSize: 24, color }}>💬</Text>,
                }}
            />
            <Tab.Screen 
                name="Profile" 
                component={ProfileScreen}
                options={{
                    tabBarIcon: ({ color }) => <Text style={{ fontSize: 24, color }}>👤</Text>,
                }}
            />
            {isAdmin && (
                <Tab.Screen 
                    name="Admin" 
                    component={AdminScreen}
                    options={{
                        tabBarIcon: ({ color }) => <Text style={{ fontSize: 24, color }}>🔒</Text>,
                    }}
                />
            )}
        </Tab.Navigator>
    );
}

// Main App Component
export default function App() {
    const [isReady, setIsReady] = useState(false);
    const [showSplash, setShowSplash] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [needsOnboarding, setNeedsOnboarding] = useState(false);
    const [needsVerification, setNeedsVerification] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const navigationRef = useRef(null);

    useEffect(() => {
        async function prepare() {
            try {
                // Initialize Firebase, Supabase, and core services
                await initializeAppCore();
                
                // Check auth state
                const authState = await getAuthState();
                
                if (authState.user) {
                    const userData = getCurrentUserData();
                    
                    if (authState.user.emailVerified) {
                        if (userData?.displayName && userData?.displayName !== 'User') {
                            setIsAuthenticated(true);
                            setNeedsOnboarding(false);
                        } else {
                            setIsAuthenticated(true);
                            setNeedsOnboarding(true);
                        }
                    } else {
                        setIsAuthenticated(true);
                        setNeedsVerification(true);
                    }
                    
                    const adminEmail = 'theprimestarventures@gmail.com';
                    if (authState.user.email === adminEmail) {
                        setIsAdmin(true);
                    }
                } else {
                    setIsAuthenticated(false);
                }
            } catch (error) {
                console.error('App initialization error:', error);
            } finally {
                setIsReady(true);
            }
        }
        
        prepare();
    }, []);

    const handleSplashFinish = () => {
        setShowSplash(false);
    };

    const handleNavigationReady = () => {
        if (navigationRef.current) {
            global.navigationRef = navigationRef;
        }
    };

    // Show animated splash screen
    if (showSplash) {
        return <AnimatedSplashScreen onFinish={handleSplashFinish} />;
    }

    // Show nothing while loading
    if (!isReady) {
        return null;
    }

    return (
        <GestureHandlerRootView style={styles.container}>
            <SafeAreaProvider>
                <NavigationContainer ref={navigationRef} onReady={handleNavigationReady}>
                    <Stack.Navigator screenOptions={{ headerShown: false }}>
                        {!isAuthenticated ? (
                            <Stack.Screen name="Auth" component={AuthScreen} />
                        ) : needsVerification ? (
                            <Stack.Screen name="Verification" component={VerificationScreen} />
                        ) : needsOnboarding ? (
                            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
                        ) : showSettings ? (
                            <Stack.Screen name="Settings">
                                {() => <SettingsScreen onClose={() => setShowSettings(false)} />}
                            </Stack.Screen>
                        ) : (
                            <Stack.Screen name="Main">
                                {() => (
                                    <MainTabs 
                                        isAdmin={isAdmin} 
                                        onOpenSettings={() => setShowSettings(true)}
                                    />
                                )}
                            </Stack.Screen>
                        )}
                    </Stack.Navigator>
                </NavigationContainer>
                <Toast />
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f0f0f',
    },
    tabBar: {
        backgroundColor: '#1a1a1a',
        borderTopColor: '#2c2c2c',
        borderTopWidth: 1,
        paddingBottom: 8,
        paddingTop: 8,
        height: 70,
    },
    tabBarLabel: {
        fontSize: 10,
        fontWeight: '500',
        marginTop: 4,
    },
});

const splashStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#faf7f2',
    },
    video: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
});

// Make Toast globally available
global.showToast = (message, type = 'info') => {
    Toast.show({
        type: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
        text1: message,
        position: 'bottom',
        visibilityTime: 3000,
    });
};
