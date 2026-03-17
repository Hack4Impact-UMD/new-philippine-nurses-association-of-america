import { Timestamp } from "firebase/firestore";

export interface ChapterAlias {
  id?: string;
  chapterId: string;
  aliasName: string;
  createdBy: string;
  createdAt?: Timestamp;
  lastUpdated?: Timestamp;
}
