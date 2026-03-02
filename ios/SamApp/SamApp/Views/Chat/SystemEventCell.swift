import SwiftUI

struct SystemEventCell: View {
    let text: String

    var body: some View {
        HStack {
            Spacer()
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(.quaternary)
                .clipShape(Capsule())
            Spacer()
        }
    }
}
