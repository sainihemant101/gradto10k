// ============================================================
// firebase-config.js
// 1. Go to https://console.firebase.google.com → your project
//    → Project settings → Your apps → Web app → SDK setup & config
// 2. Paste your config object below.
// 3. Optional: paste your published Google Sheet CSV URL so the
//    app can refresh the plan from the sheet (File → Share →
//    Publish to web → select the plan tab → CSV). Leave "" to
//    use the bundled plan.json only.
// ============================================================

export const firebaseConfig = {
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAHr_XTQwNpVYtTBbGzJ0qEozYEsF07RBU",
  authDomain: "gradto10k.firebaseapp.com",
  projectId: "gradto10k",
  storageBucket: "gradto10k.firebasestorage.app",
  messagingSenderId: "545781898441",
  appId: "1:545781898441:web:683539f7df2a634b93c118",
  measurementId: "G-Z266J9VDSX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

};

// Example:
// "https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=1937408403&single=true&output=csv"
export const SHEET_CSV_URL = "";
