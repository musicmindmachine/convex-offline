import { browser } from "$app/environment";
import { createCollection, type Collection } from "@tanstack/db";
import {
  convexCollectionOptions,
  persistence,
  type EditorBinding,
  type Persistence,
} from "@trestleinc/replicate/client";
import { api } from "$convex/_generated/api";
import { commentSchema, type Comment } from "$lib/types";
import { getConvexClient } from "$lib/convex";
import initSqlJs from "sql.js";

type CommentsCollection = Collection<Comment> & {
  utils: {
    prose(documentId: string, field: "body"): Promise<EditorBinding>;
  };
  singleResult?: never;
};

let commentsCollection: CommentsCollection | null = null;
let commentsPersistence: Persistence | null = null;

export async function initCommentsPersistence(): Promise<Persistence> {
  if (commentsPersistence) return commentsPersistence;

  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });
  commentsPersistence = await persistence.sqlite.browser(SQL, "comments");
  return commentsPersistence;
}

export function useComments(): CommentsCollection {
  if (!browser) {
    throw new Error("useComments can only be used in browser");
  }
  if (!commentsPersistence) {
    throw new Error("Call initCommentsPersistence() before useComments()");
  }
  if (!commentsCollection) {
    const convexClient = getConvexClient();
    commentsCollection = createCollection(
      convexCollectionOptions({
        schema: commentSchema,
        convexClient,
        api: api.comments,
        getKey: (comment: Comment) => comment.id,
        persistence: commentsPersistence,
      }),
    ) as unknown as CommentsCollection;
  }
  return commentsCollection;
}

export type { Comment } from "$lib/types";
