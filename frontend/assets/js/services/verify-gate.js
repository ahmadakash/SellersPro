/*
 * Seller pages: only signed-in users with a VERIFIED email may stay.
 * (Firestore rules enforce the same thing on the server.)
 */

import { auth } from "../config/firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
  if (!user || user.emailVerified) return;

  // The link may have been opened after this session started: refresh once.
  try {
    await user.reload();
    await user.getIdToken(true);
  } catch (error) {
    console.warn("Could not refresh verification state:", error);
  }

  if (auth.currentUser && auth.currentUser.emailVerified) return;

  await signOut(auth).catch(() => {});
  window.location.replace("../auth/login.html?verify=1");
});
