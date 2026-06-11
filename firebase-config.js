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
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx"
};

// Example:
// "https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=1937408403&single=true&output=csv"
export const SHEET_CSV_URL = "";
