import { getMessaging } from 'firebase-admin/messaging';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK
let app;
if (!global.firebaseAdminApp) {
    const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
    
    app = initializeApp({
        credential: cert(serviceAccount)
    });
    global.firebaseAdminApp = app;
} else {
    app = global.firebaseAdminApp;
}

const db = getFirestore(app);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { userId, title, body, data, clickAction } = req.body;
    
    if (!userId || !title || !body) {
        return res.status(400).json({ error: 'Missing required fields: userId, title, body' });
    }
    
    try {
        // ========== STEP 1: Save notification to receiver's Firestore ==========
        const notificationsRef = db.collection('users').doc(userId).collection('notifications');
        await notificationsRef.add({
            title: title,
            body: body,
            link: clickAction || '/',
            read: false,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        
        // Increment unread count for badge
        const metaRef = db.collection('user_notification_meta').doc(userId);
        await db.runTransaction(async (transaction) => {
            const metaDoc = await transaction.get(metaRef);
            if (metaDoc.exists) {
                transaction.update(metaRef, { unreadCount: FieldValue.increment(1) });
            } else {
                transaction.set(metaRef, { unreadCount: 1 });
            }
        });
        
        console.log('✅ Notification saved to Firestore for user:', userId);
        
        // ========== STEP 2: Send FCM push notification ==========
        const userDoc = await db.collection('users').doc(userId).get();
        const fcmToken = userDoc.data()?.fcmToken;
        
        if (!fcmToken) {
            return res.status(200).json({ success: true, message: 'Notification saved, no FCM token' });
        }
        
        const message = {
            token: fcmToken,
            notification: {
                title: title,
                body: body
            },
            data: {
                ...data,
                click_action: clickAction || '/',
                url: clickAction || '/'
            },
            webpush: {
                fcmOptions: {
                    link: clickAction || '/'
                }
            }
        };
        
        const messaging = getMessaging(app);
        const response = await messaging.send(message);
        
        res.status(200).json({ success: true, messageId: response, firestoreSaved: true });
        
    } catch (error) {
        console.error('Notification error:', error);
        res.status(500).json({ error: error.message });
    }
}
