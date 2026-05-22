/** Seed listings; `ownerId` is set at server startup via syncDemoListingOwners (demo lister user). */
const properties = [
  {
    id: 1,
    title: "2 Bedroom Apartment",
    location: "Kilimani, Nairobi",
    type: "rent",
    price: 65000,
    description: "Spacious apartment close to malls and schools with reliable water and security.",
    imageUrl: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80",
    imageUrls: [
      "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80"
    ]
  },
  {
    id: 2,
    title: "Modern Office Space",
    location: "Westlands, Nairobi",
    type: "lease",
    price: 180000,
    description: "Prime office floor with open workspace, meeting rooms, and fast internet infrastructure.",
    imageUrl: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    imageUrls: [
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80"
    ],
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    paymentStatus: "paid",
    premiumMediaUnlocked: true
  },
  {
    id: 3,
    title: "3 Bedroom Townhouse",
    location: "Karen, Nairobi",
    type: "rent",
    price: 120000,
    description: "Family-friendly townhouse with private garden in a secure gated community.",
    imageUrl: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80",
    imageUrls: [
      "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=80"
    ],
    paymentStatus: "paid",
    premiumMediaUnlocked: true
  },
  {
    id: 4,
    title: "Studio Apartment",
    location: "Ngong Road, Nairobi",
    type: "rent",
    price: 28000,
    description: "Compact studio with modern finishes and easy access to transport and shopping.",
    imageUrl: "https://images.unsplash.com/photo-1493666438817-866a91353ca9?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: 5,
    title: "Commercial Retail Unit",
    location: "Mombasa Road, Nairobi",
    type: "lease",
    price: 95000,
    description: "High-footfall retail space ideal for showrooms, minimarts, and service outlets.",
    imageUrl: "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: 6,
    title: "4 Bedroom Villa",
    location: "Runda, Nairobi",
    type: "rent",
    price: 250000,
    description: "Luxury villa featuring spacious living areas, mature garden, and ample parking.",
    imageUrl: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80",
    imageUrls: [
      "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1600573472591-ee6b68d14c68?auto=format&fit=crop&w=1200&q=80"
    ],
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
    paymentStatus: "paid",
    premiumMediaUnlocked: true
  },
  {
    id: 7,
    title: "1 Bedroom Bedsitter",
    location: "Ruaka, Kiambu",
    type: "rent",
    price: 18000,
    description: "Affordable and well-lit bedsitter perfect for students and young professionals.",
    imageUrl: "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80"
  },
  {
    id: 8,
    title: "Warehouse & Storage Unit",
    location: "Industrial Area, Nairobi",
    type: "lease",
    price: 320000,
    description: "Large storage and distribution unit with truck access and loading bay facilities.",
    imageUrl: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=80"
  }
];

const defaultVisibilityExpiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
properties.forEach((item) => {
  if (!Object.prototype.hasOwnProperty.call(item, "visibilityExpiresAt")) {
    item.visibilityExpiresAt = defaultVisibilityExpiresAt;
  }
  if (!Object.prototype.hasOwnProperty.call(item, "isExpired")) {
    item.isExpired = false;
  }
  if (!Object.prototype.hasOwnProperty.call(item, "expiredAt")) {
    item.expiredAt = null;
  }
});

module.exports = properties;
