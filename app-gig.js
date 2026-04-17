// ========================================
// GigsCourt - Gigs Module (React Native)
// Register Gig, Submit Review, Cancel Gig
// ========================================

import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ActivityIndicator,
    ScrollView
} from 'react-native';
import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    setDoc,
    doc,
    updateDoc,
    addDoc,
    onSnapshot,
    limit,
    increment
} from 'firebase/firestore';

// Import from core
import {
    haptic,
    formatRelativeTime,
    getOptimizedImageUrl
} from './app-core';

// ========== GLOBAL REFERENCES ==========
const db = global.db;
const auth = global.auth;
const supabase = global.supabase;

// ========== RECALCULATE STALE GIG COUNTERS ==========
export async function recalculateStaleCounters(userId) {
    try {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) return null;
        
        const userData = userSnap.data();
        const countersUpdatedAt = userData.countersUpdatedAt;
        
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const lastUpdated = countersUpdatedAt ? new Date(countersUpdatedAt) : new Date(0);
        
        if (lastUpdated > oneHourAgo) {
            return {
                gigsLast7Days: userData.gigsLast7Days || 0,
                gigsLast30Days: userData.gigsLast30Days || 0,
                isStale: false
            };
        }
        
        console.log('🔄 Counters stale — recalculating for user:', userId);
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const gigsQuery = query(
            collection(db, 'gigs'),
            where('providerId', '==', userId),
            where('status', '==', 'completed')
        );
        
        const snapshot = await getDocs(gigsQuery);
        
        let gigsLast7Days = 0;
        let gigsLast30Days = 0;
        
        snapshot.forEach(doc => {
            const gig = doc.data();
            const completedAt = gig.completedAt ? new Date(gig.completedAt) : null;
            
            if (completedAt) {
                if (completedAt >= sevenDaysAgo) gigsLast7Days++;
                if (completedAt >= thirtyDaysAgo) gigsLast30Days++;
            }
        });
        
        await updateDoc(userRef, {
            gigsLast7Days: gigsLast7Days,
            gigsLast30Days: gigsLast30Days,
            countersUpdatedAt: new Date().toISOString()
        });
        
        return {
            gigsLast7Days: gigsLast7Days,
            gigsLast30Days: gigsLast30Days,
            isStale: true
        };
        
    } catch (error) {
        console.error('❌ recalculateStaleCounters error:', error);
        return null;
    }
}

// ========== REGISTER GIG ==========
export async function registerGig(chatId, clientId) {
    console.log('🚀 registerGig called with chatId:', chatId, 'clientId:', clientId);
    
    global.showToast('Registering gig...');
    haptic('light');
    
    try {
        const providerId = auth.currentUser.uid;
        
        const providerRef = doc(db, 'users', providerId);
        const providerSnap = await getDoc(providerRef);
        
        if (!providerSnap.exists()) {
            throw new Error('Provider profile not found');
        }
        
        const providerData = providerSnap.data();
        const currentCredits = providerData.credits || 0;
        
        if (currentCredits <= 0) {
            throw new Error('Insufficient credits. Please buy more credits.');
        }
        
        // Check for existing pending gig
        const gigsRef = collection(db, 'chats', chatId, 'gigs');
        const pendingQuery = query(gigsRef, where('status', '==', 'pending_review'), limit(1));
        const pendingSnap = await getDocs(pendingQuery);
        
        if (!pendingSnap.empty) {
            const pendingGig = pendingSnap.docs[0].data();
            if (pendingGig.providerId === providerId || pendingGig.clientId === providerId) {
                throw new Error('A pending gig already exists with this user');
            }
        }
        
        // Create gig
        const gigDoc = await addDoc(gigsRef, {
            providerId: providerId,
            clientId: clientId,
            status: 'pending_review',
            registeredAt: new Date().toISOString(),
            completedAt: null,
            cancelledAt: null,
            cancelledBy: null,
            review: null,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
        
        console.log('✅ Firestore gig created:', gigDoc.id);
        
        // Update chat
        const chatRef = doc(db, 'chats', chatId);
        await updateDoc(chatRef, { 
            pendingReview: true,
            pendingGigId: gigDoc.id
        });
        
        // Update Supabase
        try {
            await supabase
                .from('provider_locations')
                .update({ last_gig_date: new Date().toISOString() })
                .eq('user_id', providerId);
        } catch (err) {
            console.warn('Could not update location:', err);
        }
        
        // Send notification
        const providerName = global.currentUserData?.displayName || 'Provider';
        await global.sendPushNotification(
            clientId,
            'New Gig Request',
            `${providerName} registered a gig with you. Please review within 7 days.`,
            `/chat/${chatId}`
        );
        
        await global.addNotification(
            clientId,
            'New Gig Request',
            `${providerName} registered a gig with you. Please review within 7 days.`
        );
        
        global.showToast('✅ Gig registered! Client will review within 7 days.', 'success');
        haptic('heavy');
        
    } catch (error) {
        console.error('❌ registerGig error:', error);
        global.showToast(error.message || 'Error registering gig', 'error');
        haptic('error');
    }
}

// ========== SUBMIT REVIEW ==========
export async function submitReview(providerId, clientId, rating, reviewText, chatId) {
    global.showToast('Submitting review...');
    haptic('light');
    
    try {
        const gigsRef = collection(db, 'chats', chatId, 'gigs');
        const q = query(
            gigsRef,
            where('status', '==', 'pending_review'),
            where('providerId', '==', providerId),
            where('clientId', '==', clientId),
            limit(1)
        );
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            throw new Error('No pending gig found to review');
        }
        
        const gigDoc = snapshot.docs[0];
        const gigRef = doc(db, 'chats', chatId, 'gigs', gigDoc.id);
        
        // Update gig
        await updateDoc(gigRef, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            review: {
                rating: rating,
                comment: reviewText || '',
                submittedAt: new Date().toISOString()
            }
        });
        
        // Update chat
        const chatRef = doc(db, 'chats', chatId);
        await updateDoc(chatRef, { pendingReview: false });
        
        // Get provider data
        const providerRef = doc(db, 'users', providerId);
        const providerSnap = await getDoc(providerRef);
        
        if (!providerSnap.exists()) {
            throw new Error('Provider profile not found');
        }
        
        const providerData = providerSnap.data();
        const currentCredits = providerData.credits || 0;
        const currentGigCount = providerData.gigCount || 0;
        const currentTotalRatingSum = providerData.totalRatingSum || 0;
        const currentReviewCount = providerData.reviewCount || 0;
        
        if (currentCredits <= 0) {
            throw new Error('Provider has insufficient credits');
        }
        
        // Deduct credit and update stats
        const newCredits = currentCredits - 1;
        const newGigCount = currentGigCount + 1;
        const newTotalRatingSum = currentTotalRatingSum + rating;
        const newReviewCount = currentReviewCount + 1;
        const newRating = newTotalRatingSum / newReviewCount;
        
        await updateDoc(providerRef, {
            credits: newCredits,
            gigCount: newGigCount,
            totalRatingSum: newTotalRatingSum,
            reviewCount: newReviewCount,
            rating: newRating,
            gigsLast7Days: increment(1),
            gigsLast30Days: increment(1),
            countersUpdatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        // Save review
        const reviewsRef = collection(db, 'reviews');
        const reviewId = `${providerId}_${clientId}`;
        await setDoc(doc(reviewsRef, reviewId), {
            providerId: providerId,
            clientId: clientId,
            rating: rating,
            review: reviewText || '',
            gigId: gigDoc.id,
            createdAt: new Date().toISOString()
        });
        
        // Add transaction
        const transactionsRef = collection(db, 'transactions');
        await addDoc(transactionsRef, {
            userId: providerId,
            type: 'gig_used',
            credits: -1,
            amount: 0,
            reference: gigDoc.id,
            createdAt: new Date().toISOString()
        });
        
        // Update Supabase
        try {
            await supabase
                .from('provider_locations')
                .update({ 
                    rating: newRating,
                    gig_count: newGigCount
                })
                .eq('user_id', providerId);
        } catch (err) {
            console.warn('Could not update location stats:', err);
        }
        
        // Credit alerts
        if (newCredits === 2) {
            await global.addNotification(providerId, 'Low Credits', '⚠️ You have 2 credits left. Buy more to keep registering gigs.');
        } else if (newCredits === 1) {
            await global.addNotification(providerId, 'Low Credits', '⚠️ Only 1 credit left!');
        } else if (newCredits === 0) {
            await global.addNotification(providerId, 'Low Credits', '❌ You\'re out of credits. Buy credits to register new gigs.');
        }
        
        // Milestone alerts
        if (newGigCount === 1) {
            await global.addNotification(providerId, '🎉 Milestone!', 'Congrats on your first gig!');
        } else if (newGigCount === 5) {
            await global.addNotification(providerId, '🎉 Milestone!', '5 gigs completed! You\'re on fire!');
        } else if (newGigCount === 10) {
            await global.addNotification(providerId, '🎉 Milestone!', '10 gigs! You\'re a GigsCourt pro!');
        }
        
        global.showToast(`✅ Review submitted! ${rating} stars. Thank you!`, 'success');
        haptic('heavy');
        
        return true;
        
    } catch (error) {
        console.error('submitReview error:', error);
        global.showToast(error.message || 'Error submitting review', 'error');
        haptic('error');
        throw error;
    }
}

// ========== CANCEL GIG ==========
export async function cancelGig(chatId, providerId) {
    try {
        const currentUser = auth.currentUser.uid;
        
        const gigsRef = collection(db, 'chats', chatId, 'gigs');
        const q = query(
            gigsRef,
            where('status', '==', 'pending_review'),
            where('clientId', '==', currentUser),
            where('providerId', '==', providerId),
            limit(1)
        );
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            global.showToast('No pending gig found to cancel', 'error');
            return;
        }
        
        const gigDoc = snapshot.docs[0];
        const gigRef = doc(db, 'chats', chatId, 'gigs', gigDoc.id);
        
        await updateDoc(gigRef, {
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            cancelledBy: currentUser
        });
        
        const chatRef = doc(db, 'chats', chatId);
        await updateDoc(chatRef, { pendingReview: false });
        
        await global.addNotification(providerId, 'Gig Cancelled', 'Client cancelled the gig request. No credits were deducted.');
        
        global.showToast('✅ Gig cancelled successfully', 'success');
        
    } catch (error) {
        console.error('cancelGig error:', error);
        global.showToast('Error cancelling gig', 'error');
    }
}

// ========== CHECK GIG STATUS AND UPDATE UI ==========
export async function checkGigStatusAndUpdateUI(chatId, userId) {
    // This is now handled in the ChatScreen component with real-time listeners
    console.log('checkGigStatusAndUpdateUI called for chat:', chatId);
}

// ========== SHOW REVIEW BOTTOM SHEET ==========
export function showReviewBottomSheet(providerId, chatId) {
    // This is now handled in the ChatScreen component
    console.log('showReviewBottomSheet called for provider:', providerId);
}

// ========== SHOW REVIEWS ==========
export async function showReviews(providerId) {
    try {
        const reviewsRef = collection(db, 'reviews');
        const q = query(
            reviewsRef,
            where('providerId', '==', providerId),
            limit(50)
        );
        
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            global.showToast('No reviews yet', 'info');
            return;
        }
        
        const reviews = [];
        snapshot.forEach(doc => {
            reviews.push(doc.data());
        });
        
        // Show in Alert for now (simple)
        const reviewText = reviews.slice(0, 5).map(r => 
            `★ ${r.rating} - ${r.review || 'No comment'}`
        ).join('\n\n');
        
        Alert.alert('Reviews', reviewText || 'No reviews yet');
        
    } catch (error) {
        console.error('showReviews error:', error);
        global.showToast('Error loading reviews', 'error');
    }
}

// ========== SHOW RECENT CHATS FOR GIG ==========
export async function showRecentChatsForGig() {
    try {
        const chatsRef = collection(db, 'chats');
        const q = query(
            chatsRef,
            where('participants', 'array-contains', auth.currentUser.uid)
        );
        
        const snapshot = await getDocs(q);
        
        const recentUsers = [];
        
        snapshot.forEach(doc => {
            const chat = doc.data();
            const otherId = chat.participants.find(p => p !== auth.currentUser.uid);
            const otherUserInfo = chat.participantInfo?.[otherId] || {
                displayName: 'User',
                photoURL: null
            };
            
            recentUsers.push({
                id: otherId,
                displayName: otherUserInfo.displayName || 'User',
                chatId: doc.id
            });
        });
        
        // Remove duplicates
        const uniqueUsers = [];
        const seenIds = new Set();
        for (const user of recentUsers) {
            if (!seenIds.has(user.id)) {
                seenIds.add(user.id);
                uniqueUsers.push(user);
            }
        }
        
        if (uniqueUsers.length === 0) {
            global.showToast('No recent chats found', 'info');
            return;
        }
        
        // Show in Alert
        Alert.alert(
            'Select a client',
            'Choose who you worked with',
            uniqueUsers.slice(0, 10).map(u => ({
                text: u.displayName,
                onPress: () => registerGig(u.chatId, u.id)
            })).concat([{ text: 'Cancel', style: 'cancel' }])
        );
        
    } catch (error) {
        console.error('showRecentChatsForGig error:', error);
        global.showToast('Error loading recent chats', 'error');
    }
}

// ========== GET ROLLING 30-DAY GIG COUNT ==========
export async function getRolling30DayGigCount(userId) {
    if (!userId) return 0;
    
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const gigsQuery = query(
            collection(db, 'gigs'),
            where('providerId', '==', userId),
            where('status', '==', 'completed')
        );
        
        const snapshot = await getDocs(gigsQuery);
        
        let count = 0;
        snapshot.forEach(doc => {
            const gig = doc.data();
            const completedAt = gig.completedAt ? new Date(gig.completedAt) : null;
            if (completedAt && completedAt >= thirtyDaysAgo) {
                count++;
            }
        });
        
        return count;
    } catch (error) {
        console.error('getRolling30DayGigCount error:', error);
        return 0;
    }
}

// ========== EXPORT ALL FUNCTIONS ==========
export {
    registerGig,
    submitReview,
    cancelGig,
    checkGigStatusAndUpdateUI,
    showReviewBottomSheet,
    showReviews,
    showRecentChatsForGig,
    getRolling30DayGigCount,
    recalculateStaleCounters
};

// Make globally available
global.registerGig = registerGig;
global.submitReview = submitReview;
global.cancelGig = cancelGig;
global.checkGigStatusAndUpdateUI = checkGigStatusAndUpdateUI;
global.showReviewBottomSheet = showReviewBottomSheet;
global.showReviews = showReviews;
global.showRecentChatsForGig = showRecentChatsForGig;
global.getRolling30DayGigCount = getRolling30DayGigCount;
global.recalculateStaleCounters = recalculateStaleCounters;

console.log('✅ app-gigs.js loaded');
