import SwiftUI

// MARK: - Menu Section

enum MenuSection: Int, CaseIterable, Identifiable {
    case chat, memory, skills, settings

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .memory: "Memory"
        case .skills: "Skills"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .memory: "brain"
        case .skills: "hammer"
        case .settings: "gear"
        }
    }
}

// MARK: - Main View

struct MainTabView: View {
    @Environment(AppViewModel.self) private var appVM
    @State private var selectedSection: MenuSection = .chat
    @State private var isDrawerOpen = false

    private let drawerWidth: CGFloat = 280

    var body: some View {
        ZStack(alignment: .leading) {
            // Main content
            NavigationStack {
                contentView
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button {
                                withAnimation(.easeInOut(duration: 0.25)) {
                                    isDrawerOpen.toggle()
                                }
                            } label: {
                                Image(systemName: "line.3.horizontal")
                                    .imageScale(.large)
                            }
                        }
                    }
            }
            .disabled(isDrawerOpen)

            // Dimming overlay
            if isDrawerOpen {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isDrawerOpen = false
                        }
                    }
            }

            // Side drawer
            HStack(spacing: 0) {
                drawerContent
                    .frame(width: drawerWidth)
                    .background(.background)
                Spacer()
            }
            .offset(x: isDrawerOpen ? 0 : -drawerWidth - 20)
            .animation(.easeInOut(duration: 0.25), value: isDrawerOpen)
        }
        .gesture(
            DragGesture()
                .onEnded { value in
                    let threshold: CGFloat = 80
                    if value.translation.width > threshold && !isDrawerOpen {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isDrawerOpen = true
                        }
                    } else if value.translation.width < -threshold && isDrawerOpen {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isDrawerOpen = false
                        }
                    }
                }
        )
        .onAppear {
            if appVM.hasConfiguredConnection {
                appVM.connect()
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var contentView: some View {
        switch selectedSection {
        case .chat:
            SessionListView()
        case .memory:
            MemoryListView()
        case .skills:
            SkillListView()
        case .settings:
            SettingsView()
        }
    }

    // MARK: - Drawer

    private var drawerContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Text("Sam")
                .font(.title.bold())
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 24)

            Divider()
                .padding(.bottom, 8)

            // Menu items
            ForEach(MenuSection.allCases) { section in
                Button {
                    selectedSection = section
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isDrawerOpen = false
                    }
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: section.icon)
                            .frame(width: 24)
                            .imageScale(.large)
                        Text(section.title)
                            .font(.body)
                        Spacer()
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(
                        selectedSection == section
                            ? Color.accentColor.opacity(0.1)
                            : Color.clear
                    )
                    .foregroundStyle(
                        selectedSection == section
                            ? Color.accentColor
                            : Color.primary
                    )
                }
            }

            Spacer()
        }
    }
}
