// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "C64CommanderNativeTests",
    products: [
        .library(name: "NativeValidation", targets: ["NativeValidation"]),
    ],
    targets: [
        .target(name: "NativeValidation"),
        .testTarget(name: "NativeValidationTests", dependencies: ["NativeValidation"]),
    ]
)
