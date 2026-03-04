import SwiftUI
import MarkdownUI

struct MarkdownMessageCell: View {
    let text: String

    var body: some View {
        Markdown(text)
            .markdownTextStyle {
                FontSize(15)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
