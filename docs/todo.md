
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

there is some issue with the group endpoints, it tries to remove the wrong group id, instead of using the actual id?
I tried to fix this but now it's sometimes crashing mqtt. Not really sure. it works well enough though to be a real issue, and can be addressed later. the functionality works for the user and my application handles the logic fine. it's just the mqtt that throws some error.