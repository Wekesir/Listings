const test = require("node:test");
const assert = require("node:assert/strict");
const { createUnreadEmailScheduler } = require("../utils/unreadEmailScheduler");

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("unread email scheduler debounces repeated key events", async () => {
  const sentPayloads = [];
  const scheduler = createUnreadEmailScheduler({
    delayMs: 25,
    handler: (payload) => {
      sentPayloads.push(payload);
    }
  });

  scheduler.schedule("42:17", { unread: 1 });
  scheduler.schedule("42:17", { unread: 2 });
  await wait(50);

  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads[0], { unread: 2 });
  assert.equal(scheduler.pendingCount(), 0);
});

test("unread email scheduler runs independent keys", async () => {
  const sentPayloads = [];
  const scheduler = createUnreadEmailScheduler({
    delayMs: 20,
    handler: (payload) => {
      sentPayloads.push(payload.key);
    }
  });

  scheduler.schedule("conv1:user7", { key: "a" });
  scheduler.schedule("conv2:user9", { key: "b" });
  await wait(45);

  assert.deepEqual(sentPayloads.sort(), ["a", "b"]);
  assert.equal(scheduler.pendingCount(), 0);
});

test("unread email scheduler clearAll cancels pending notifications", async () => {
  let callCount = 0;
  const scheduler = createUnreadEmailScheduler({
    delayMs: 30,
    handler: () => {
      callCount += 1;
    }
  });

  scheduler.schedule("conv3:user4", { key: "x" });
  scheduler.schedule("conv4:user5", { key: "y" });
  scheduler.clearAll();
  await wait(50);

  assert.equal(callCount, 0);
  assert.equal(scheduler.pendingCount(), 0);
});
