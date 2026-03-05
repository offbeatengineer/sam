import SwiftUI

struct WebSearchCardCell: View {
    let details: WebSearchDetails
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header — tap to expand/collapse
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(details.query)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Spacer()
                    Text(details.provider)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text("\(details.results.count) results")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.secondary.opacity(0.05))
            }
            .buttonStyle(.plain)

            // Results — collapsible
            if expanded {
                Divider()

                ForEach(Array(details.results.enumerated()), id: \.offset) { _, result in
                Button {
                    if let url = URL(string: result.url) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 5) {
                                if let favicon = result.favicon, let faviconURL = URL(string: favicon) {
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

                                Text(result.title)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.blue)
                                    .lineLimit(1)
                            }

                            HStack(spacing: 4) {
                                if let siteName = result.siteName {
                                    Text(siteName)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if result.siteName != nil && result.age != nil {
                                    Text("·")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if let age = result.age {
                                    Text(age)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            if !result.description.isEmpty {
                                Text(result.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }

                        Spacer(minLength: 0)

                        if let thumbnail = result.thumbnail, let thumbURL = URL(string: thumbnail) {
                            AsyncImage(url: thumbURL) { phase in
                                if case .success(let image) = phase {
                                    image.resizable()
                                        .aspectRatio(contentMode: .fill)
                                        .frame(width: 56, height: 42)
                                        .clipShape(RoundedRectangle(cornerRadius: 4))
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)

                if result.url != details.results.last?.url {
                    Divider().padding(.leading, 12)
                }
                }
            }
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
