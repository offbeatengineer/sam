import SwiftUI

struct WebFetchCardCell: View {
    let details: WebFetchDetails

    private var host: String {
        URL(string: details.url)?.host ?? details.url
    }

    private var formattedLength: String {
        if details.contentLength < 1024 {
            return "\(details.contentLength) chars"
        } else if details.contentLength < 1024 * 1024 {
            return String(format: "%.1fK chars", Double(details.contentLength) / 1024.0)
        } else {
            return String(format: "%.1fM chars", Double(details.contentLength) / (1024.0 * 1024.0))
        }
    }

    var body: some View {
        Button {
            if let url = URL(string: details.url) {
                UIApplication.shared.open(url)
            }
        } label: {
            HStack(alignment: .top, spacing: 0) {
                // OG image on left
                if let image = details.image, let imageURL = URL(string: image) {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .success(let img):
                            img.resizable()
                                .aspectRatio(contentMode: .fill)
                        case .failure:
                            Color.clear
                                .frame(width: 0)
                        default:
                            Color(.systemFill)
                                .overlay {
                                    ProgressView()
                                }
                        }
                    }
                    .frame(width: 100)
                    .clipped()
                }

                VStack(alignment: .leading, spacing: 4) {
                    // Site info
                    HStack(spacing: 5) {
                        if let favicon = details.favicon, let faviconURL = URL(string: favicon) {
                            AsyncImage(url: faviconURL) { phase in
                                if case .success(let image) = phase {
                                    image.resizable()
                                        .frame(width: 14, height: 14)
                                        .clipShape(RoundedRectangle(cornerRadius: 2))
                                } else {
                                    Image(systemName: "globe")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        } else {
                            Image(systemName: "globe")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Text(details.siteName ?? host)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)

                        Spacer()

                        Image(systemName: "arrow.up.right")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    // Title
                    Text(details.title.isEmpty ? host : details.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(2)

                    // Description
                    if let description = details.description, !description.isEmpty {
                        Text(description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }

                    // Footer
                    HStack(spacing: 4) {
                        Image(systemName: "doc.text")
                            .font(.caption2)
                        Text(formattedLength)
                            .font(.caption2)
                        if details.truncated {
                            Text("truncated")
                                .font(.caption2)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color.orange.opacity(0.15))
                                .foregroundStyle(.orange)
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                        }
                    }
                    .foregroundStyle(.tertiary)
                }
                .padding(12)
            }
            .frame(minHeight: 80)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}
