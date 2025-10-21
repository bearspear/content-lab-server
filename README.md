# Content Lab Server

Portable desktop server for Content Lab - A lightweight Node.js server that packages Content Lab as a standalone executable for multiple platforms.

## Overview

Content Lab Server is a distribution package that bundles the Content Lab Angular application with a Node.js Express server into platform-specific executables. This allows users to run Content Lab locally without installing Node.js or any dependencies.

## Features

- **Portable Executables** - Single-file executables for macOS, Windows, and Linux
- **No Installation Required** - Run Content Lab without Node.js or npm installed
- **Automatic Browser Launch** - Opens Content Lab in your default browser on startup
- **HTTP Compression** - Optimized static file serving with gzip/deflate compression
- **CORS Enabled** - Configured for cross-origin requests
- **Custom Port Support** - Configure server port via environment variable

## Prerequisites

**For Building:**
- Node.js 18+ (for development and building executables)
- npm 8+
- Access to Content Lab Angular build output

**For Running Built Executables:**
- No prerequisites - executables are self-contained

## Installation

```bash
# Clone or navigate to the project directory
cd content-lab-server

# Install dependencies
npm install
```

## Project Structure

```
content-lab-server/
├── server.js           # Express server implementation
├── package.json        # Project configuration and pkg settings
├── public/            # Content Lab Angular app (copied from content-lab build)
│   ├── index.html
│   ├── assets/
│   └── *.js, *.css
└── dist/              # Built executables (generated)
    ├── content-lab-server-macos-x64
    ├── content-lab-server-macos-arm64
    ├── content-lab-server-win-x64.exe
    └── content-lab-server-linux-x64
```

## Building Executables

### Step 1: Build Content Lab Angular App

First, build the Content Lab Angular application with relative base href:

```bash
# Navigate to the content-lab project
cd /path/to/content-lab

# Build Angular app for distribution
npx ng build content-lab --configuration=production --base-href ./
```

### Step 2: Copy Build to Server

```bash
# From content-lab-server directory
cd /path/to/content-lab-server

# Remove old public directory
rm -rf public

# Copy new build
cp -r /path/to/content-lab/dist/apps/content-lab/browser public
```

### Step 3: Build Executables

```bash
# Build all platform executables
npm run build
```

This creates executables in the `dist/` directory:
- `content-lab-server-macos-x64` - macOS Intel (x64)
- `content-lab-server-macos-arm64` - macOS Apple Silicon (ARM64)
- `content-lab-server-win-x64.exe` - Windows 64-bit
- `content-lab-server-linux-x64` - Linux 64-bit

## Running the Server

### Development Mode

```bash
# Run with Node.js directly
npm start

# Or with custom port
PORT=4000 npm start
```

The server will:
1. Start on port 3000 (or specified PORT)
2. Serve Content Lab from the `public/` directory
3. Automatically open `http://localhost:3000` in your default browser

### Running Built Executables

**macOS:**
```bash
# Navigate to dist directory
cd dist

# Run the executable (choose based on your architecture)
./content-lab-server-macos-arm64

# Or with custom port
PORT=4000 ./content-lab-server-macos-arm64
```

**Windows:**
```cmd
cd dist
content-lab-server-win-x64.exe

REM Or with custom port
set PORT=4000 && content-lab-server-win-x64.exe
```

**Linux:**
```bash
cd dist
./content-lab-server-linux-x64

# Or with custom port
PORT=4000 ./content-lab-server-linux-x64
```

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
  ```bash
  PORT=8080 npm start
  ```

### Server Configuration

The Express server (`server.js`) includes:

```javascript
{
  compression: true,        // Gzip/deflate compression
  cors: enabled,           // Cross-origin resource sharing
  staticServe: 'public',   // Static file directory
  fallback: 'index.html'   // SPA fallback route
}
```

## Updating Content Lab

To update the Content Lab application served by the executables:

```bash
# 1. Build latest Content Lab
cd /path/to/content-lab
npx ng build content-lab --configuration=production --base-href ./

# 2. Update server public directory
cd /path/to/content-lab-server
rm -rf public
cp -r /path/to/content-lab/dist/apps/content-lab/browser public

# 3. Rebuild executables
npm run build
```

## Technical Details

### Packaging (pkg)

This project uses [pkg](https://github.com/vercel/pkg) to create standalone executables:

- **Target:** Node.js 18
- **Assets:** All files in `public/` are embedded
- **Platforms:** macOS (x64, ARM64), Windows (x64), Linux (x64)

### Server Implementation

- **Framework:** Express.js 4.x
- **Compression:** gzip/deflate via compression middleware
- **CORS:** Enabled for all origins
- **Static Files:** Served from embedded `public/` directory
- **SPA Support:** Falls back to `index.html` for client-side routing

### Angular Build Requirements

Content Lab must be built with:
- **Base href:** `./` (relative paths for file:// protocol compatibility)
- **Configuration:** production (optimized bundle)
- **Output:** `dist/apps/content-lab/browser/`

## Troubleshooting

### Executable Won't Run

**macOS:** Remove quarantine attribute
```bash
xattr -d com.apple.quarantine ./content-lab-server-macos-arm64
```

**Linux:** Add execute permissions
```bash
chmod +x ./content-lab-server-linux-x64
```

### Port Already in Use

```bash
# Use a different port
PORT=4000 ./content-lab-server-macos-arm64
```

### Browser Doesn't Open

The server will still run at `http://localhost:3000` - manually open the URL in your browser.

### Public Directory Missing

Ensure you've copied the Content Lab Angular build to the `public/` directory before building executables.

## Development

### Adding Dependencies

```bash
npm install <package-name>
```

**Note:** After adding dependencies, rebuild executables to include them.

### Modifying Server

Edit `server.js` and test with:
```bash
npm start
```

Then rebuild executables:
```bash
npm run build
```

## Distribution

Distribute the appropriate executable for each platform:

- **macOS Users:** `content-lab-server-macos-arm64` (M1/M2/M3) or `content-lab-server-macos-x64` (Intel)
- **Windows Users:** `content-lab-server-win-x64.exe`
- **Linux Users:** `content-lab-server-linux-x64`

## License

MIT

## Author

Michael Behringer

## Related Projects

- **content-lab** - Content Lab Angular application source
- **content-lab-electron** - Electron desktop app distribution

## Version

1.0.0
