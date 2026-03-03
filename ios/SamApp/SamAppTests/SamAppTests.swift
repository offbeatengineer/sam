import XCTest
@testable import SamApp

final class SamAppTests: XCTestCase {
    func testAnyCodableRoundTrip() throws {
        let original = AnyCodable(["key": "value", "number": 42])
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AnyCodable.self, from: data)
        XCTAssertEqual(original, decoded)
    }
}
