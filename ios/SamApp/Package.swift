// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SamApp",
    platforms: [.iOS(.v17)],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.3.0"),
    ],
    targets: [
        .executableTarget(
            name: "SamApp",
            dependencies: [
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            ],
            path: "SamApp"
        ),
    ]
)
