import assert from "node:assert/strict";import test from "node:test";import {planOrderStatusTransitions} from "../src/orders/orderStatusTransitionPlanner.js";
test("plans valid transitions and protects shipping",()=>{const [r]=planOrderStatusTransitions([{market:"naver",externalOrderLineId:"L1",from:"preparing",to:"shipped"}]);assert.equal(r?.requiresConfirmation,true);});
test("rejects invalid backwards transitions",()=>assert.throws(()=>planOrderStatusTransitions([{market:"naver",externalOrderLineId:"L1",from:"shipped",to:"confirmed"}]),/invalid transition/));
