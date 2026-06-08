
# BIG FEATURES:

## Adding agent logic

add more providers i.e. ollama, gemini, claude

ADD VOICE INPUT

improve prompting?

make user memory update tool diff based instead of a full rewrite

improve spotify tool suite to include finding user playlists/library

add initialize endpoint to cache weather and home information when user navigates to agent page, so the first message of each convo doesn't take extra time.

token tracking table and cost analytics - not that important right now

add pricing display for each model when selecting models.

## Adding Accounts and user settings

add admin account type with admin settings page that can edit all other users and permissions

saving home shapes

Add the ability to have rooms saved for a household, and tag devices with rooms. this way we can organize by room.

## adding routines/scheduling/automations

This is a big necessary next step for smart home robustness

add cool triggers such as sunrise/sunset

## Digital Wardrobe Management

create wardrobe table.

add option to import csv with wardrobe to mass add rows to table, or add individually in UI.

# SMALLER FEATURES:

Add encryption to secrets

Add zigbee binding devices options

add scene integration options to groups/rooms

add power on behavior adjustment

automatic hardware updates for devices, like actually a version updates for the lightbulbs or whatever

# KNOWN BUGS:

group endpoints don't work, masked the bug for adding and removing devices but issue is still there when adding and deleting, as well as only masked for add/delete. Something about the group ID not existing in database, will be useful to look at zigbee logs which I can't right now. Preferably when I fix it, I go back and clean up the jerryrigging the routes and websockets for groups I did.
