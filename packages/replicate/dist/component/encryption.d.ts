import * as convex_server8 from "convex/server";
import * as convex_values69 from "convex/values";

//#region src/component/encryption.d.ts
declare namespace encryption_d_exports {
  export { approveDevice, getDocKey, getDocKeysForUser, getPendingDevices, getWrappedUmk, listDevices, registerDevice, storeDocKey };
}
declare const registerDevice: convex_server8.RegisteredMutation<"public", {
  name?: string | undefined;
  collection: string;
  userId: string;
  deviceId: string;
  publicKey: ArrayBuffer;
}, Promise<{
  id: convex_values69.GenericId<"devices">;
  isNew: boolean;
  autoApproved?: undefined;
} | {
  id: convex_values69.GenericId<"devices">;
  isNew: boolean;
  autoApproved: boolean;
}>>;
declare const listDevices: convex_server8.RegisteredQuery<"public", {
  collection: string;
  userId: string;
}, Promise<{
  _id: convex_values69.GenericId<"devices">;
  _creationTime: number;
  name?: string | undefined;
  collection: string;
  userId: string;
  deviceId: string;
  publicKey: ArrayBuffer;
  created: number;
  lastSeen: number;
  approved: boolean;
}[]>>;
declare const getPendingDevices: convex_server8.RegisteredQuery<"public", {
  collection: string;
  userId: string;
}, Promise<{
  _id: convex_values69.GenericId<"devices">;
  _creationTime: number;
  name?: string | undefined;
  collection: string;
  userId: string;
  deviceId: string;
  publicKey: ArrayBuffer;
  created: number;
  lastSeen: number;
  approved: boolean;
}[]>>;
declare const approveDevice: convex_server8.RegisteredMutation<"public", {
  collection: string;
  userId: string;
  deviceId: string;
  wrappedUmk: ArrayBuffer;
}, Promise<{
  success: boolean;
}>>;
declare const getWrappedUmk: convex_server8.RegisteredQuery<"public", {
  collection: string;
  userId: string;
  deviceId: string;
}, Promise<ArrayBuffer | null>>;
declare const storeDocKey: convex_server8.RegisteredMutation<"public", {
  collection: string;
  userId: string;
  document: string;
  wrappedKey: ArrayBuffer;
}, Promise<{
  id: convex_values69.GenericId<"docKeys">;
}>>;
declare const getDocKey: convex_server8.RegisteredQuery<"public", {
  collection: string;
  userId: string;
  document: string;
}, Promise<ArrayBuffer | null>>;
declare const getDocKeysForUser: convex_server8.RegisteredQuery<"public", {
  collection: string;
  userId: string;
}, Promise<{
  _id: convex_values69.GenericId<"docKeys">;
  _creationTime: number;
  collection: string;
  userId: string;
  created: number;
  document: string;
  wrappedKey: ArrayBuffer;
}[]>>;
//#endregion
export { approveDevice, encryption_d_exports, getDocKey, getDocKeysForUser, getPendingDevices, getWrappedUmk, listDevices, registerDevice, storeDocKey };
//# sourceMappingURL=encryption.d.ts.map