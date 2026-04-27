APP_NAME := Skills Manager
PRODUCT := NativeSkillsManager
BUNDLE_ID := com.dk.skillsmanager
VERSION := 0.1.0
BUILD_DIR := .build
RELEASE_BIN := $(BUILD_DIR)/release/$(PRODUCT)
DIST_DIR := dist
APP := $(DIST_DIR)/$(APP_NAME).app
CONTENTS := $(APP)/Contents
MACOS := $(CONTENTS)/MacOS
RESOURCES := $(CONTENTS)/Resources

.PHONY: build app package clean

build:
	swift build -c release

app: build
	rm -rf "$(APP)"
	mkdir -p "$(MACOS)" "$(RESOURCES)"
	cp "$(RELEASE_BIN)" "$(MACOS)/$(APP_NAME)"
	cp assets/icon.icns "$(RESOURCES)/AppIcon.icns"
	printf '%s\n' \
		'<?xml version="1.0" encoding="UTF-8"?>' \
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
		'<plist version="1.0">' \
		'<dict>' \
		'  <key>CFBundleDevelopmentRegion</key>' \
		'  <string>en</string>' \
		'  <key>CFBundleExecutable</key>' \
		'  <string>$(APP_NAME)</string>' \
		'  <key>CFBundleIconFile</key>' \
		'  <string>AppIcon</string>' \
		'  <key>CFBundleIdentifier</key>' \
		'  <string>$(BUNDLE_ID)</string>' \
		'  <key>CFBundleInfoDictionaryVersion</key>' \
		'  <string>6.0</string>' \
		'  <key>CFBundleName</key>' \
		'  <string>$(APP_NAME)</string>' \
		'  <key>CFBundlePackageType</key>' \
		'  <string>APPL</string>' \
		'  <key>CFBundleShortVersionString</key>' \
		'  <string>$(VERSION)</string>' \
		'  <key>CFBundleVersion</key>' \
		'  <string>$(VERSION)</string>' \
		'  <key>LSMinimumSystemVersion</key>' \
		'  <string>14.0</string>' \
		'  <key>NSHighResolutionCapable</key>' \
		'  <true/>' \
		'</dict>' \
		'</plist>' > "$(CONTENTS)/Info.plist"
	chmod +x "$(MACOS)/$(APP_NAME)"
	plutil -lint "$(CONTENTS)/Info.plist"
	codesign --force --sign - "$(APP)"

package: app
	cd "$(DIST_DIR)" && zip -qry "$(APP_NAME).zip" "$(APP_NAME).app"

clean:
	rm -rf "$(DIST_DIR)"
	swift package clean
