const test = require("node:test");
const assert = require("node:assert/strict");
const properties = require("../data/properties");
const { pool } = require("../config/db");
const { getMyListingEngagement } = require("../controllers/propertyController");

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("getMyListingEngagement returns aggregated totals per owned listing", async () => {
  const originalProperties = properties.map((item) => ({ ...item }));
  const originalExecute = pool.execute;

  properties.length = 0;
  properties.push(
    { id: 101, ownerId: 77, title: "A", location: "Nairobi", listingStatus: "published", isPublished: true, isSoftDeleted: false },
    { id: 102, ownerId: 77, title: "B", location: "Kisumu", listingStatus: "published", isPublished: true, isSoftDeleted: false },
    { id: 103, ownerId: 99, title: "C", location: "Mombasa", listingStatus: "published", isPublished: true, isSoftDeleted: false }
  );

  pool.execute = async (sql) => {
    if (sql.includes("FROM listing_view_events")) {
      return [[
        { propertyId: 101, viewCount: 12 },
        { propertyId: 102, viewCount: 4 }
      ]];
    }
    if (sql.includes("FROM property_shortlists")) {
      return [[
        { propertyId: 101, interestedShortlist: 3 },
        { propertyId: 102, interestedShortlist: 1 }
      ]];
    }
    if (sql.includes("FROM listing_conversations c") && sql.includes("INNER JOIN listing_messages")) {
      return [[
        { propertyId: 101, reachedOut: 2 },
        { propertyId: 102, reachedOut: 1 }
      ]];
    }
    if (sql.includes("FROM listing_conversations")) {
      return [[
        { propertyId: 101, interestedInquiry: 2 },
        { propertyId: 102, interestedInquiry: 1 }
      ]];
    }
    throw new Error(`Unexpected SQL in test: ${sql.slice(0, 70)}`);
  };

  const req = { session: { user: { id: 77, accountType: "lister" } } };
  const res = createMockRes();
  await getMyListingEngagement(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.listings?.length, 2);
  assert.deepEqual(res.body?.totals, {
    views: 16,
    interestedShortlist: 4,
    interestedInquiry: 3,
    reachedOut: 3
  });

  pool.execute = originalExecute;
  properties.length = 0;
  originalProperties.forEach((item) => properties.push(item));
});

test("getMyListingEngagement rejects missing session", async () => {
  const req = { session: {} };
  const res = createMockRes();
  await getMyListingEngagement(req, res);
  assert.equal(res.statusCode, 401);
});
