# GigsCourt - React Native App

Connect with local gig workers instantly. Built with Expo and React Native.

## 📱 What You Need

- An Android phone OR iPhone
- GitHub account (you already have this)
- Free Expo account (create at https://expo.dev)

## 🚀 Quick Setup (From Your Phone)

### Step 1: Create Expo Account
1. Go to https://expo.dev/signup
2. Sign up with your email (free)
3. Verify your email

### Step 2: Add Secrets to GitHub
1. Go to your repo → Settings → Secrets and variables → Actions
2. Add these secrets:

| Name | Value | Where to Find |
|------|-------|---------------|
| `EXPO_TOKEN` | (your token) | https://expo.dev/settings/access-tokens |

To get your Expo token:
1. Go to https://expo.dev/settings/access-tokens
2. Tap "Create Token"
3. Name it "GitHub Actions"
4. Copy the token and paste as `EXPO_TOKEN` secret

### Step 3: Build the App
1. Go to the "Actions" tab
2. Tap "Build App" on the left
3. Tap "Run workflow" button
4. Select "android" (or "ios")
5. Tap "Run workflow"
6. Wait 15-20 minutes

### Step 4: Download and Install

**Android:**
1. When build finishes, tap the workflow run
2. Scroll to "Artifacts"
3. Tap "android-apk" to download
4. Open the APK file
5. Allow "Install unknown apps" if prompted
6. Tap "Install"

**iPhone (Sideloading with Scarlet):**
1. Download the iOS artifact (ios-app)
2. Install Scarlet from https://usescarlet.com
3. Open Scarlet → Tap "+" → Select the .app file
4. Trust the certificate in Settings → General → VPN & Device Management
5. App installs on your home screen

## 🎨 Changing App Icons (From Your Phone)

1. Download Canva app (free)
2. Create a 1024x1024 design
3. Use your brand colors and "GC" text
4. Export as PNG
5. Go to https://www.iloveimg.com/resize-image
6. Resize to:
   - 1024x1024 (icon.png)
   - 1242x2436 (splash.png)
7. Upload to `assets/` folder in your repo

## 🔧 Environment Variables (Vercel)

Deploy the `/api` folder to Vercel and add these environment variables:

| Variable | Description |
|----------|-------------|
| `FIREBASE_PROJECT_ID` | From Firebase Console |
| `FIREBASE_CLIENT_EMAIL` | From Firebase service account |
| `FIREBASE_PRIVATE_KEY` | From Firebase service account |
| `IMAGEKIT_PUBLIC_KEY` | From ImageKit dashboard |
| `IMAGEKIT_PRIVATE_KEY` | From ImageKit dashboard |
| `IMAGEKIT_URL_ENDPOINT` | From ImageKit dashboard |
| `CRON_SECRET` | Any random string (for expire-gigs security) |

## 📂 File Structure

```

gigscourt-app/
├── App.js                 # Main entry point
├── app-core.js            # Auth, onboarding, notifications
├── app-features.js        # Home, search, chat, profile
├── app-gigs.js            # Gig registration and reviews
├── firebase-config.js     # Firebase configuration
├── app.json               # Expo configuration
├── package.json           # Dependencies
├── babel.config.js        # Babel configuration
├── eas.json               # EAS Build configuration
├── vercel.json            # Vercel cron configuration
├── .gitignore             # Files to ignore
├── api/                   # Serverless functions
│   ├── send-notification.js
│   ├── imagekit-auth.js
│   └── expire-gigs.js
├── .github/workflows/     # GitHub Actions
│   └── build.yml
└── assets/                # App icons (add these)
├── icon.png
├── splash.png
└── adaptive-icon.png

```

## ❓ Common Issues

**Build fails with "npm ci" error?**
- Go to Actions → tap the failed build → "Re-run jobs"

**App crashes on open?**
- Make sure Firebase config is correct in `firebase-config.js`

**Notifications not working?**
- Deploy the `/api` folder to Vercel
- Add all environment variables

## 🆘 Need Help?

1. Check the Actions tab for build errors
2. Make sure all secrets are added
3. Verify Firebase and Supabase are working in your PWA first

## 📱 Testing Without Building

For instant testing while developing:
1. Install "Expo Go" app from App Store / Play Store
2. Go to https://expo.dev/@your-username/gigscourt
3. Scan QR code with Expo Go
4. Changes appear instantly when you save files!

---

**You're ready to build! 🎉**
