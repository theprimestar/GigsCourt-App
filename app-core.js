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
