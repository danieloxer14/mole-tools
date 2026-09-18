x In the agent view, can we have "Enter to send" and "Shift+Enter for a new line" on two seperate lines.

- The file labels on the review layers have some issues.
  x They don't have a hover state
  x They don't have a selected state when the file is visible (it should be a filled orange)
  x Can we make the default text color for the review layer descriptions white.
  x The progress bars don't fill correctly.
- There is no top padding on the review layers.
  x There is no border on the file header/changed files section to seperate the sections.
- There are wrapping issues for long file paths on the agent view.
- The titles of the review layers are sometimes orange and sometimes white. Can we make them always white.
- Can we ensure the commit sha is inline with the header. I think the issue is because of the icon button size.
- Similar issue with the review layers icon not aligned with the completed layers counter
  x Can we make the "Approve" button green.
- The header bar is too cramped and overflowing. Because each icon is it's own button, we should design a mutually exclusive icon toggle button and replace the current components. Additional if a item is checked can it be a filled orange.
  x Similarly for the find in file, we need a custom component that combines up the icons and counters in an inline search
  x The tooltips are shown twice, once with the nice component and once using the browser. Can we just have the nice component.
  x For the "Tag whole file" can we just have the tag icon and a tooltip.
  x The settings are narrow and don't show all of the modal contents
  x Can we reduce the text size of the agent dropdown text, including the menu of the dropdown.
  x There is an issue with the main view caused by comments not wrapping correctly, and thus pushing the width of the code diff section. Can we fix this to eleminite the horizontal scrolling.
  x Can we move the "Explain" button and orange button, similar to the agent send message button.
