
# BIG FEATURES:

## Adding agent logic

add more providers i.e. ollama, gemini, claude

improve prompting?

token tracking table and cost analytics - not that important right now

add pricing display for each model when selecting models.

Resolve user IP address and provide current user location to model.

Web search tool

## Spotify improvement

Create headless sink spotify connection container to run on pi for constant spotify connection.

## Voice input

Need to create edge node containers for wakeword listening and tts stt responses.

improve ui voice input to websocket instead of rest for faster processing.

## Adding Accounts and user settings

add admin account type with admin settings page that can edit all other users and permissions

## rooms

add sorting by room to devices page.

inform agent of device state by room organization

## adding routines/scheduling/automations

This is a big necessary next step for smart home robustness

add cool triggers such as sunrise/sunset

## FE improvements

Chat doesn't expand to full screen, margin at bottom.

Bottom bar doesn't show on mobile, need to scroll to see it.

Rooms canvas is unusable on mobile. 

## Digital Wardrobe Management

create wardrobe table.

add option to import csv with wardrobe to mass add rows to table, or add individually in UI.

# SMALLER FEATURES:

Add zigbee binding devices options

add scene integration options to groups/rooms

add power on behavior adjustment

automatic hardware updates for devices, like actually a version updates for the lightbulbs or whatever

# KNOWN BUGS:

group endpoints don't work, masked the bug for adding and removing devices but issue is still there when adding and deleting, as well as only masked for add/delete. Something about the group ID not existing in database, will be useful to look at zigbee logs which I can't right now. Preferably when I fix it, I go back and clean up the jerryrigging the routes and websockets for groups I did.
