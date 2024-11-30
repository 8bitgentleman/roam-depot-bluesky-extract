Extract Bluesky posts into your Roam Research graph with formatted text and images.

## Features

- Extract Bluesky posts with a customizable template
- Import images as child blocks or inline
- Auto-extract posts on graph load when tagged
- Multiple ways to trigger extraction:
  - Right-click menu
  - Command palette
  - Keyboard shortcut (Ctrl+Shift+B)

## Usage

1. Paste a Bluesky post URL into a block
2. Either:
   - Use the right-click menu and select "Extract Bluesky Post"
   - Use the command palette (Cmd+P) and search for "Extract Bluesky Post"
   - Use the keyboard shortcut Ctrl+Shift+B (configurable)

## Configuration

The plugin can be configured in the Roam Depot settings panel:

- **Post Template**: Customize how extracted posts appear using variables:
  - `{POST}` - Post content
  - `{URL}` - Post URL
  - `{AUTHOR_NAME}` - Author's display name
  - `{AUTHOR_HANDLE}` - Author's Bluesky handle
  - `{AUTHOR_URL}` - Author's Bluesky profile URL
  - `{DATE}` - Post date
  - `{NEWLINE}` - Line break
  - `{IMAGES}` - Post images (when using inline mode)

- **Image Location**: Choose how images are handled:
  - Child block: Images appear as blocks under the post
  - Inline: Images appear within the post block
  - Skip images: Images are not extracted

- **Auto Extract**: Automatically extract posts tagged with a specific tag when Roam loads. This is particularly useful when using a Quick Caption solution on mobile. When browsing bluesky share a post to roam and tag the block before sending it. Next time you load up your graph the post will be automatically extracted.
- **Auto Extract Tag**: Customize the tag used for auto-extraction (default: "bluesky-extract")


