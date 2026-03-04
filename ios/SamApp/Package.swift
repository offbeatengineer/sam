// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SamApp",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/exyte/Chat.git", from: "2.7.0"),
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.3.0"),
    ],
    targets: [
        .executableTarget(
            name: "SamApp",
            dependencies: [
                .product(name: "ExyteChat", package: "Chat"),
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            ],
            path: "SamApp"
        ),
    ]
)
