// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.1"),
        .package(name: "CapacitorCommunityFileOpener", path: "../../../node_modules/.pnpm/@capacitor-community+file-opener@8.0.0_@capacitor+core@8.0.2/node_modules/@capacitor-community/file-opener"),
        .package(name: "CapacitorApp", path: "../../../node_modules/.pnpm/@capacitor+app@8.0.0_@capacitor+core@8.0.2/node_modules/@capacitor/app"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/.pnpm/@capacitor+filesystem@8.1.0_@capacitor+core@8.0.2/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorLocalNotifications", path: "../../../node_modules/.pnpm/@capacitor+local-notifications@8.0.0_@capacitor+core@8.0.2/node_modules/@capacitor/local-notifications"),
        .package(name: "CapacitorStatusBar", path: "../../../node_modules/.pnpm/@capacitor+status-bar@8.0.0_@capacitor+core@8.0.2/node_modules/@capacitor/status-bar")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityFileOpener", package: "CapacitorCommunityFileOpener"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar")
            ]
        ),
        .testTarget(
            name: "CapApp-SPMTests",
            dependencies: ["CapApp-SPM"]
        )
    ]
)
