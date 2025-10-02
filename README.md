# Next.js AI Interview Practice App

This is a web application for practicing job interviews with an AI, built with Next.js, React, Three.js, and the Google Gemini API. It features a Google Meet-like UI, real-time voice chat, live transcription, and a 3D audio visualizer.

## Setup Instructions

### 1. Clean Up Old Files

This project is a complete migration from a previous Lit-based structure. Before you begin, please **delete all the old files** from the original project (e.g., `index.html`, `index.tsx`, `visual-3d.ts`, etc.) to avoid conflicts.

### 2. Install Dependencies

Install the required packages using npm:

```bash
npm install
```

### 3. Set Up Environment Variables

You need to provide your Google Gemini API key.

1.  Create a new file named `.env.local` in the root of the project.
2.  Add your API key to this file:

```
NEXT_PUBLIC_API_KEY="YOUR_GEMINI_API_KEY_HERE"
```

**Note:** The Gemini Live API SDK runs on the client, which requires the API key to be available in the browser. In Next.js, this is handled by prefixing the environment variable with `NEXT_PUBLIC_`.

### 4. Place Static Assets

The 3D visualizer requires an EXR texture file.

1.  Obtain the `piz_compressed.exr` file.
2.  Place it inside the `/public` directory at the root of the project.

### 5. Run the Development Server

Start the Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
