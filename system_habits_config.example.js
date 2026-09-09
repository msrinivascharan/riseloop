window.SystemHabitsConfig = {
  apiKey: "YOUR_GOOGLE_API_KEY",
  spreadsheetId: "YOUR_GOOGLE_SHEET_ID",
  clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID",
  scopes: "https://www.googleapis.com/auth/spreadsheets",
  // Optional — only needed for the AI Analysis page.
  // Free key from https://aistudio.google.com/apikey
  geminiApiKey: "YOUR_GEMINI_API_KEY_HERE"
  // Optional: pin a model, e.g. geminiModel: "gemini-2.5-flash".
  // Leave it out and the app picks a working model your key can access.
};
