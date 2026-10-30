# My Diary

A private digital diary. Each person creates an account and gets their own pages with text, highlighter marks, photos, sticky notes, torn paper and stickers, all freely placed. Built with Node.js (Express) and MongoDB.

## 1. Create the free database (about 10 minutes)

1. Sign up at https://www.mongodb.com/cloud/atlas and create a free cluster (M0).
2. Database Access: add a database user with a password.
3. Network Access: allow access from anywhere (0.0.0.0/0). Hosting sites change IP addresses, so this is normally required. The database user's password is what protects it, so make it long.
4. Connect > Drivers: copy the connection string.

## 2. Run it on your computer

    npm install
    cp .env.example .env      # then fill in MONGODB_URI and JWT_SECRET
    npm start

Open http://localhost:3000, create an account, and write a page.

## 3. Put it online for your friends

1. Upload this folder to a GitHub repository (the .gitignore keeps .env out).
2. On a Node.js hosting site (Render, Railway, Fly.io and similar), create a web service from the repository.
   - Build command: npm install
   - Start command: npm start
3. Add the same settings from .env as environment variables on the host, and set NODE_ENV=production.
4. Open the address the host gives you, and share it. Check the host's current free plan limits first. Free plans often put the app to sleep when idle, so the first visit after a quiet period can be slow.

To keep it friends-only, set SIGNUP_CODE and tell your friends the code. Leave it empty to let anyone sign up.

## What to know before inviting people

- Photos are shrunk in the browser and stored in MongoDB (GridFS). Each person gets PHOTO_QUOTA_MB of photo space, because the free database holds 512 MB in total.
- The free MongoDB tier has no automatic backups. The Backup button in the app downloads a person's written entries and layout as JSON. It does not include photos.
- Passwords are stored hashed (bcrypt). Login attempts are rate limited. Photos can only be opened by their owner when logged in.
- There is no password reset by email yet. If someone forgets their password, their account cannot be recovered.
- You are keeping other people's private writing. Keep the database password and JWT_SECRET secret, and keep dependencies updated (npm audit).
