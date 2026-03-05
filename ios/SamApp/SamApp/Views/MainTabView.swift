import SwiftUI

// MARK: - Menu Section

enum MenuSection: Int, CaseIterable, Identifiable {
    case chat, memory, skills, artifacts, kits, settings

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .chat: "Chat"
        case .memory: "Memory"
        case .skills: "Skills"
        case .artifacts: "Artifacts"
        case .kits: "Kits"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right"
        case .memory: "brain"
        case .skills: "hammer"
        case .artifacts: "doc.on.doc"
        case .kits: "shippingbox"
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
        case .artifacts:
            ArtifactListView()
        case .kits:
            KitListView()
        case .settings:
            SettingsView()
        }
    }

    // MARK: - Drawer

    private var drawerContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Instance switcher header
            Menu {
                ForEach(appVM.settingsVM.instances) { instance in
                    Button {
                        appVM.switchInstance(to: instance.id)
                    } label: {
                        if appVM.settingsVM.activeInstanceId == instance.id {
                            Label(instance.name, systemImage: "checkmark")
                        } else {
                            Text(instance.name)
                        }
                    }
                }

                Divider()

                Button {
                    selectedSection = .settings
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isDrawerOpen = false
                    }
                } label: {
                    Label("Manage Instances…", systemImage: "server.rack")
                }
            } label: {
                HStack(spacing: 8) {
                    Text(appVM.settingsVM.activeInstance?.name ?? "Sam")
                        .font(.title2.bold())
                        .foregroundStyle(.primary)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Spacer()
                    connectionDot
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 24)
            }
            .compositingGroup()

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

    // MARK: - Connection indicator

    @ViewBuilder
    private var connectionDot: some View {
        switch appVM.connectionManager.status {
        case .connected:
            Circle().fill(.green).frame(width: 8, height: 8)
        case .connecting, .reconnecting:
            Circle().fill(.orange).frame(width: 8, height: 8)
        case .error:
            Circle().fill(.red).frame(width: 8, height: 8)
        case .disconnected:
            Circle().fill(.gray).frame(width: 8, height: 8)
        }
    }
}
