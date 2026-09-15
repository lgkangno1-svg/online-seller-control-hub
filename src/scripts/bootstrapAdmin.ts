import "dotenv/config";
import { resolve } from "node:path";
import { AccountStore } from "../persistence/accountStore.js";

const username = required("SELLERHUB_ADMIN_USERNAME").trim();
const password = required("SELLERHUB_ADMIN_PASSWORD");
const path = resolve(process.env.ACCOUNT_STORE_PATH ?? "./data/accounts.json");
const sessionDays = Number(process.env.ACCOUNT_SESSION_DAYS ?? "7");

const store = await AccountStore.load(path, sessionDays);
const identity = await store.bootstrapAdmin({ username, password });
console.log(`SellerHub admin ready: username=${identity.username ?? username}; role=${identity.role}; userId=${identity.userId}`);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
