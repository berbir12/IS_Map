# 🌐 ismap — Community-Powered Internet Speed Map

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![React 19](https://img.shields.io/badge/React-19.0-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.2-purple.svg)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-emerald.svg)](https://supabase.com/)

**ismap** is an open-source, community-powered application for real-time internet speed testing and geographic coverage visualization. Users can test their connection speed, rate their ISP performance, view spatial heatmaps, and export connection datasets.

---

## ✨ Features

- ⚡ **Real-Time Speed Testing**: Accurately measures Ping (ms), Download (Mbps), and Upload (Mbps) using distributed Cloudflare endpoints.
- 🗺️ **Interactive Coverage Map**: Color-coded Leaflet / OpenStreetMap visualization showing real-world connection nodes (Fast 90+ Mbps, Medium 50-89 Mbps, Fair <50 Mbps).
- 📍 **Spatial Data Aggregation**: Postgres & Supabase backend with weighted spatial grouping (~150m radius, 20-minute time window).
- 📊 **Data Export**: Export connection benchmarks directly into `.csv` format for analysis.
- 🛡️ **Privacy First**: Exact coordinates remain anonymized, and personal test history is stored securely in local browser storage.
- 🔍 **Search & Filters**: Filter map points by ISP provider, connection quality, speed range, or date window.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, React-Leaflet / OpenStreetMap, Lucide Icons
- **Backend / Database**: Supabase (PostgreSQL, Realtime Subscriptions)
- **Deployment**: Vercel

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/your-username/internetspeedma.git
cd internetspeedma
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Add your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run database migrations
Execute the SQL migration files located in `supabase/migrations/` sequentially in your Supabase SQL Editor.

### 5. Start development server
```bash
npm run dev
```

---

## 🤝 Contributing

We welcome community contributions! Here's how you can help:

1. **Fork the repo** and create a feature branch (`git checkout -b feature/amazing-feature`).
2. Make your changes and verify with `npm run build` & `npm run lint`.
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to your branch (`git push origin feature/amazing-feature`).
5. Open a **Pull Request**.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for detailed guidelines.

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
