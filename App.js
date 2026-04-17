// ========================================
// GigsCourt - React Native App Entry
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
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Import core module (contains all Firebase/Supabase initialization and auth logic)
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

// Bottom Tab Navigator
function MainTabs({ isAdmin }) {
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
                    
                    // Check if email is verified
                    if (authState.user.emailVerified) {
                        // Check if profile exists (has displayName)
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
                    
                    // Check admin access
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
                await SplashScreen.hideAsync();
            }
        }
        
        prepare();
    }, []);

    // Handle navigation ref for programmatic navigation
    const handleNavigationReady = () => {
        // Make navigation available globally for core module
        if (navigationRef.current) {
            global.navigationRef = navigationRef;
        }
    };

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
                            // Auth stack
                            <Stack.Screen name="Auth" component={AuthScreen} />
                        ) : needsVerification ? (
                            // Email verification stack
                            <Stack.Screen name="Verification" component={VerificationScreen} />
                        ) : needsOnboarding ? (
                            // Onboarding stack
                            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
                        ) : showSettings ? (
                            // Settings modal
                            <Stack.Screen name="Settings">
                                {() => <SettingsScreen onClose={() => setShowSettings(false)} />}
                            </Stack.Screen>
                        ) : (
                            // Main app stack
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

// Make Toast globally available
global.showToast = (message, type = 'info') => {
    Toast.show({
        type: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
        text1: message,
        position: 'bottom',
        visibilityTime: 3000,
    });
};
