import { initializeApp } from "firebase-admin/app";
import { syncMembers } from "./sync-members";
import { syncEvents } from "./sync-events";
import { updateMembers } from "./update-members";
import { createUser } from "./create-user";
import { wildApricotWebhook } from "./webhook-handler";

initializeApp();

export { syncMembers, syncEvents, updateMembers, createUser, wildApricotWebhook };
