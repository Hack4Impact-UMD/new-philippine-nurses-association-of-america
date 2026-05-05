"use client";

import { useState, useEffect } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export function useDocument<T>(
  collectionName: string,
  docId: string | undefined
) {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!docId) {
      setLoading(false);
      return;
    }

    const docRef = doc(db, collectionName, docId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setData({ ...snapshot.data(), id: snapshot.id } as T & { id: string });
        } else {
          setData(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionName, docId]);

  return { data, loading, error };
}

export function useCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
) {
  const [data, setData] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const ref = collection(db, collectionName);
    const q = query(ref, ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map(
          (doc) => ({ ...doc.data(), id: doc.id }) as T & { id: string }
        );
        setData(docs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, JSON.stringify(constraints)]);

  return { data, loading, error };
}

/**
 * One-shot collection fetch — same shape as `useCollection` but uses `getDocs`
 * instead of a live listener. Use for slow-changing data (members, chapters)
 * to avoid the listener-overhead and redundant snapshot deliveries.
 */
export function useCollectionOnce<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
) {
  const [data, setData] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const ref = collection(db, collectionName);
    const q = query(ref, ...constraints);
    getDocs(q)
      .then((snapshot) => {
        if (cancelled) return;
        setData(
          snapshot.docs.map(
            (doc) => ({ ...doc.data(), id: doc.id }) as T & { id: string }
          )
        );
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName, JSON.stringify(constraints)]);

  return { data, loading, error };
}

/** One-shot single-doc fetch. See `useCollectionOnce` for rationale. */
export function useDocumentOnce<T>(
  collectionName: string,
  docId: string | undefined
) {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!docId) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    getDoc(doc(db, collectionName, docId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          setData({ ...(snap.data() as T), id: snap.id });
        } else {
          setData(null);
        }
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionName, docId]);

  return { data, loading, error };
}
