"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUser = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
exports.createUser = (0, https_1.onCall)(async (request) => {
    // Only allow national admins to create users
    if (request.auth?.token?.role !== "national_admin") {
        throw new https_1.HttpsError("permission-denied", "Only national admins can create users");
    }
    const data = request.data;
    const { email, displayName, role, chapterName, region } = data;
    if (!email || !displayName || !role) {
        throw new https_1.HttpsError("invalid-argument", "email, displayName, and role are required");
    }
    const auth = (0, auth_1.getAuth)();
    const db = (0, firestore_1.getFirestore)();
    try {
        // Create Firebase Auth user
        const userRecord = await auth.createUser({
            email,
            displayName,
        });
        // Create Firestore user document
        await db.collection("users").doc(userRecord.uid).set({
            email,
            displayName,
            role,
            chapterName: chapterName || null,
            region: region || null,
            createdAt: firestore_1.Timestamp.now(),
            lastLogin: firestore_1.Timestamp.now(),
        });
        // Set custom claims
        await auth.setCustomUserClaims(userRecord.uid, {
            role,
            chapterName: chapterName || null,
            region: region || null,
        });
        return { uid: userRecord.uid, success: true };
    }
    catch (error) {
        console.error("Error creating user:", error);
        throw new https_1.HttpsError("internal", "Failed to create user");
    }
});
//# sourceMappingURL=create-user.js.map