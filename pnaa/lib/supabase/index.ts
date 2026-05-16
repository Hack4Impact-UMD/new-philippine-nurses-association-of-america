// Drop-in re-export surface mirroring lib/firebase/index.ts so existing
// `import { ... } from "@/lib/firebase"` paths keep working after the move.

export { supabase as auth, supabase as db } from "./client";
export {
  membersRef,
  chaptersRef,
  eventsRef,
  fundraisingRef,
  usersRef,
  getDocument,
  queryCollection,
  addDocument,
  updateDocument,
  archiveDocument,
} from "./firestore";
