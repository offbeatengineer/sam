import SwiftUI
import MarkdownUI

struct MarkdownMessageCell: View {
    let text: String

    var body: some View {
        HStack {
            Markdown(text)
                .markdownTextStyle {
                    FontSize(15)
                }
            Spacer(minLength: 40)
        }
    }
}
