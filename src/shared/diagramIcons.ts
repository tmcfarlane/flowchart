// Original local SVG illustrations. Stable ids are stored in chart documents;
// paths are a fixed build-time allowlist, never supplied by users.

export interface DiagramIcon {
  id: string
  name: string
  category: string
  path: string
  keywords: readonly string[]
  provider: 'flowchart'
}

export const DIAGRAM_ICONS: readonly DiagramIcon[] = [
  {
    "id": "icon-cloud",
    "name": "Cloud",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-cloud.svg",
    "keywords": [
      "hosting",
      "cloud",
      "compute"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-database",
    "name": "Database",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-database.svg",
    "keywords": [
      "database",
      "db",
      "sql",
      "postgres",
      "persistent"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-server",
    "name": "Server",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-server.svg",
    "keywords": [
      "server",
      "backend",
      "compute",
      "rack"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-api",
    "name": "API",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-api.svg",
    "keywords": [
      "api",
      "endpoint",
      "gateway",
      "integration",
      "rest"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-queue",
    "name": "Message queue",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-queue.svg",
    "keywords": [
      "queue",
      "event",
      "message",
      "bus",
      "stream"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-cache",
    "name": "Cache",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-cache.svg",
    "keywords": [
      "cache",
      "redis",
      "fast",
      "memory"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-network",
    "name": "Network",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-network.svg",
    "keywords": [
      "network",
      "topology",
      "connection",
      "router"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-browser",
    "name": "Browser",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-browser.svg",
    "keywords": [
      "web",
      "website",
      "frontend",
      "browser"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-code",
    "name": "Code",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-code.svg",
    "keywords": [
      "code",
      "software",
      "development",
      "github",
      "git"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-terminal",
    "name": "Terminal",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-terminal.svg",
    "keywords": [
      "terminal",
      "shell",
      "cli",
      "command"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-container",
    "name": "Container",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-container.svg",
    "keywords": [
      "container",
      "docker",
      "kubernetes",
      "deployment",
      "pod"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-storage",
    "name": "File storage",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-storage.svg",
    "keywords": [
      "storage",
      "file",
      "object",
      "bucket",
      "archive"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-webhook",
    "name": "Webhook",
    "category": "infrastructure",
    "path": "/assets/diagram-icons/icon-webhook.svg",
    "keywords": [
      "webhook",
      "callback",
      "trigger",
      "event"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-robot",
    "name": "AI assistant",
    "category": "technology",
    "path": "/assets/diagram-icons/icon-robot.svg",
    "keywords": [
      "ai",
      "robot",
      "assistant",
      "agent",
      "machine",
      "intelligence"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-sparkles",
    "name": "Sparkles",
    "category": "technology",
    "path": "/assets/diagram-icons/icon-sparkles.svg",
    "keywords": [
      "generate",
      "ai",
      "magic",
      "sparkle",
      "inspiration"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-workflow",
    "name": "Workflow",
    "category": "technology",
    "path": "/assets/diagram-icons/icon-workflow.svg",
    "keywords": [
      "workflow",
      "process",
      "automation",
      "flowchart"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-search",
    "name": "Search",
    "category": "technology",
    "path": "/assets/diagram-icons/icon-search.svg",
    "keywords": [
      "search",
      "retrieval",
      "rag",
      "find",
      "magnify"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-globe",
    "name": "Globe",
    "category": "technology",
    "path": "/assets/diagram-icons/icon-globe.svg",
    "keywords": [
      "internet",
      "global",
      "world",
      "geography"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-lock",
    "name": "Lock",
    "category": "security",
    "path": "/assets/diagram-icons/icon-lock.svg",
    "keywords": [
      "lock",
      "secure",
      "authentication",
      "privacy"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-key",
    "name": "Key",
    "category": "security",
    "path": "/assets/diagram-icons/icon-key.svg",
    "keywords": [
      "key",
      "secret",
      "credentials",
      "token",
      "password"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-shield",
    "name": "Shield",
    "category": "security",
    "path": "/assets/diagram-icons/icon-shield.svg",
    "keywords": [
      "shield",
      "security",
      "protection",
      "trust",
      "compliance"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-fingerprint",
    "name": "Fingerprint",
    "category": "security",
    "path": "/assets/diagram-icons/icon-fingerprint.svg",
    "keywords": [
      "fingerprint",
      "identity",
      "biometric",
      "identity"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-user",
    "name": "Person",
    "category": "people",
    "path": "/assets/diagram-icons/icon-user.svg",
    "keywords": [
      "person",
      "user",
      "customer",
      "actor",
      "human"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-users",
    "name": "Team",
    "category": "people",
    "path": "/assets/diagram-icons/icon-users.svg",
    "keywords": [
      "team",
      "people",
      "users",
      "collaboration",
      "group"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-handshake",
    "name": "Partnership",
    "category": "people",
    "path": "/assets/diagram-icons/icon-handshake.svg",
    "keywords": [
      "partnership",
      "handshake",
      "agreement",
      "deal",
      "support"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-chat",
    "name": "Conversation",
    "category": "people",
    "path": "/assets/diagram-icons/icon-chat.svg",
    "keywords": [
      "chat",
      "conversation",
      "feedback",
      "support",
      "comment"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-briefcase",
    "name": "Work",
    "category": "business",
    "path": "/assets/diagram-icons/icon-briefcase.svg",
    "keywords": [
      "business",
      "work",
      "project",
      "briefcase",
      "office"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-credit-card",
    "name": "Payment card",
    "category": "business",
    "path": "/assets/diagram-icons/icon-credit-card.svg",
    "keywords": [
      "payment",
      "credit",
      "card",
      "billing",
      "checkout",
      "stripe"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-cart",
    "name": "Shopping cart",
    "category": "business",
    "path": "/assets/diagram-icons/icon-cart.svg",
    "keywords": [
      "cart",
      "commerce",
      "shop",
      "ecommerce",
      "purchase"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-invoice",
    "name": "Invoice",
    "category": "business",
    "path": "/assets/diagram-icons/icon-invoice.svg",
    "keywords": [
      "invoice",
      "receipt",
      "billing",
      "finance",
      "accounting"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-mail",
    "name": "Email",
    "category": "business",
    "path": "/assets/diagram-icons/icon-mail.svg",
    "keywords": [
      "email",
      "mail",
      "newsletter",
      "notification",
      "resend"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-bell",
    "name": "Notification",
    "category": "business",
    "path": "/assets/diagram-icons/icon-bell.svg",
    "keywords": [
      "bell",
      "alert",
      "notification",
      "reminder"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-calendar",
    "name": "Calendar",
    "category": "business",
    "path": "/assets/diagram-icons/icon-calendar.svg",
    "keywords": [
      "calendar",
      "schedule",
      "date",
      "booking",
      "appointment"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-check",
    "name": "Complete",
    "category": "business",
    "path": "/assets/diagram-icons/icon-check.svg",
    "keywords": [
      "check",
      "success",
      "complete",
      "approved",
      "done"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-chart",
    "name": "Analytics",
    "category": "business",
    "path": "/assets/diagram-icons/icon-chart.svg",
    "keywords": [
      "chart",
      "analytics",
      "metrics",
      "growth",
      "report",
      "dashboard"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-flag",
    "name": "Milestone",
    "category": "business",
    "path": "/assets/diagram-icons/icon-flag.svg",
    "keywords": [
      "flag",
      "milestone",
      "launch",
      "goal",
      "delivery"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-book",
    "name": "Book",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-book.svg",
    "keywords": [
      "book",
      "story",
      "narrative",
      "knowledge",
      "documentation"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-lightbulb",
    "name": "Idea",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-lightbulb.svg",
    "keywords": [
      "idea",
      "lightbulb",
      "inspiration",
      "brainstorm",
      "innovation"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-palette",
    "name": "Palette",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-palette.svg",
    "keywords": [
      "palette",
      "art",
      "color",
      "design",
      "illustration"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-camera",
    "name": "Camera",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-camera.svg",
    "keywords": [
      "camera",
      "photo",
      "image",
      "capture",
      "photograph"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-music",
    "name": "Music",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-music.svg",
    "keywords": [
      "music",
      "sound",
      "audio",
      "song",
      "compose"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-puzzle",
    "name": "Puzzle",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-puzzle.svg",
    "keywords": [
      "puzzle",
      "piece",
      "game",
      "solution",
      "integration"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-compass",
    "name": "Compass",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-compass.svg",
    "keywords": [
      "compass",
      "direction",
      "explore",
      "discovery",
      "navigation"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-heart",
    "name": "Heart",
    "category": "creative",
    "path": "/assets/diagram-icons/icon-heart.svg",
    "keywords": [
      "heart",
      "care",
      "wellbeing",
      "love",
      "empathy"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-rocket",
    "name": "Rocket",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-rocket.svg",
    "keywords": [
      "rocket",
      "launch",
      "space",
      "startup",
      "exploration"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-star",
    "name": "Star",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-star.svg",
    "keywords": [
      "star",
      "dream",
      "favorite",
      "night",
      "cosmic"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-moon",
    "name": "Moon",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-moon.svg",
    "keywords": [
      "moon",
      "dream",
      "sleep",
      "night",
      "lunar"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-sun",
    "name": "Sun",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-sun.svg",
    "keywords": [
      "sun",
      "daylight",
      "energy",
      "solar"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-planet",
    "name": "Planet",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-planet.svg",
    "keywords": [
      "planet",
      "cosmos",
      "orbit",
      "saturn",
      "galaxy",
      "universe"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-crystal",
    "name": "Crystal",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-crystal.svg",
    "keywords": [
      "crystal",
      "prism",
      "surreal",
      "portal",
      "gem",
      "imagination"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-portal",
    "name": "Portal",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-portal.svg",
    "keywords": [
      "portal",
      "doorway",
      "dimension",
      "surreal",
      "teleport"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-hourglass",
    "name": "Hourglass",
    "category": "cosmic",
    "path": "/assets/diagram-icons/icon-hourglass.svg",
    "keywords": [
      "hourglass",
      "time",
      "waiting",
      "delay",
      "patience"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-flask",
    "name": "Experiment",
    "category": "science",
    "path": "/assets/diagram-icons/icon-flask.svg",
    "keywords": [
      "flask",
      "experiment",
      "science",
      "lab",
      "research"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-atom",
    "name": "Atom",
    "category": "science",
    "path": "/assets/diagram-icons/icon-atom.svg",
    "keywords": [
      "atom",
      "physics",
      "science",
      "energy",
      "particle"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-dna",
    "name": "DNA",
    "category": "science",
    "path": "/assets/diagram-icons/icon-dna.svg",
    "keywords": [
      "dna",
      "biology",
      "genetics",
      "evolution",
      "research"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-leaf",
    "name": "Leaf",
    "category": "nature",
    "path": "/assets/diagram-icons/icon-leaf.svg",
    "keywords": [
      "leaf",
      "sustainability",
      "green",
      "nature",
      "environment"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-mountain",
    "name": "Mountain",
    "category": "nature",
    "path": "/assets/diagram-icons/icon-mountain.svg",
    "keywords": [
      "mountain",
      "journey",
      "challenge",
      "landscape",
      "adventure"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-wave",
    "name": "Wave",
    "category": "nature",
    "path": "/assets/diagram-icons/icon-wave.svg",
    "keywords": [
      "wave",
      "water",
      "ocean",
      "sea",
      "flow",
      "tidal"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-wind",
    "name": "Wind",
    "category": "nature",
    "path": "/assets/diagram-icons/icon-wind.svg",
    "keywords": [
      "wind",
      "air",
      "weather",
      "breeze",
      "energy"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-map",
    "name": "Map",
    "category": "nature",
    "path": "/assets/diagram-icons/icon-map.svg",
    "keywords": [
      "map",
      "travel",
      "journey",
      "route",
      "location",
      "geography"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-coffee",
    "name": "Coffee",
    "category": "life",
    "path": "/assets/diagram-icons/icon-coffee.svg",
    "keywords": [
      "coffee",
      "cafe",
      "break",
      "pause",
      "rest",
      "morning"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-gift",
    "name": "Gift",
    "category": "life",
    "path": "/assets/diagram-icons/icon-gift.svg",
    "keywords": [
      "gift",
      "reward",
      "surprise",
      "present",
      "celebration"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-graduation",
    "name": "Learning",
    "category": "life",
    "path": "/assets/diagram-icons/icon-graduation.svg",
    "keywords": [
      "learning",
      "education",
      "graduation",
      "course",
      "training"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-home",
    "name": "Home",
    "category": "life",
    "path": "/assets/diagram-icons/icon-home.svg",
    "keywords": [
      "home",
      "house",
      "habitat",
      "personal",
      "life"
    ],
    "provider": "flowchart"
  },
  {
    "id": "icon-checklist",
    "name": "Checklist",
    "category": "life",
    "path": "/assets/diagram-icons/icon-checklist.svg",
    "keywords": [
      "checklist",
      "task",
      "todo",
      "planning",
      "productivity"
    ],
    "provider": "flowchart"
  }
]

export const DIAGRAM_ICON_CATEGORIES = Array.from(new Set(DIAGRAM_ICONS.map((icon) => icon.category))).sort()
