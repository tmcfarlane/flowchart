# Product Requirements Document

## Edges
[ ] Remove Smooth step as an edge option
[ ] When you select an edge and change the edge type, it still shows "Animated Dashed" as the selected choice.
[ ] Add a new item to the tool that looks like ./assets/arrowtool.png . This should sit to the right of th hand tool and left of the box tool (to the left of the seperator). When the user clicks this it will be called the 'arrow tool' and it will drawing connection points from one node to the other ONLY. It will use the already exiting connection points and everything, we just restrict the ability to do other things while in this mode. This helps the user choose their intention
[ ] Instead of a drowndown with text selections when we select an edge, It'd be nice to have small examples of what the line will look like, instead of just text. It could show us a dashed line, a solid line, and a curvy line. These represent the different edge types and the options associated. You could but bi-directional arrows too. ./assets/linestyle.png

## Explorer Side Bar
[ ] As an added feature, add a button that will toggle the sidebar from the visual UI to a mermaid chart syntax. Something that I could realistically output, copy/paste, and get a similar experience in the app. This hits on the underlying thought that we will need some sort of "base language" to allow frictionless interaction for our apps users. The goal would be able to copy the text from one window and paste it into another window (same site) and we get repeatable results quickly.


## AI Side bar
[ ] With the explorer feature to add a "base language" like mermaid syntax to help us make repeatable patterns, We could expect the AI tool to produce/modify mermaid syntax and that's how we can get from Text -> Text -> Manual Visual implementation to Text -> Auto implementation. We can use something as simple as JSON, instead of the full mermaid syntax.
[ ] Replace the icon that is used for opening/closing the sidebar with an SVG similar to ./assets/ai-icon2.png
[ ] The experience of waiting for the AI to generate/modify the diagram could be slow. Add some randomized waiting messages combined with a progress indicator to improve the experience of waiting.
[ ] At the bottom of the entire screen (outside of the sidebar) I'd like to have one of those floating "Chat with AI" pills at the bottom that looks vaguely like the chatgpt version ./assets/bottomchat.png

## Slide show (Preview Mode)
When we click the play button we are in 'preview mode' but we need some changes:
[ ] When triggering the 'presentation mode' or slideshow, it currently shows ALL the nodes, and some grayed out. Instead, it should only show the first node, followed by the next node added wiith an edge. It should display the next node + edge connection to it. This could reveal many nodes.
[ ] Support dark mode. When we are in dark mode and we go to prsentation mode, it should still be dark mode themed for consistency.
[ ] In presentation mode, all the right and left arrow keys be used to navigate forward/backward in the steps.

## Grid
[ ] Add some light gray dots to the grid to see a grid like pattern in the background

## Toolbar
[ ] The 'hand' icon looks off. Convert the ./assets/hand.png to an SVG icon and use this instead in the toolbar.
[ ] Make the sun gray like the other icons, instead of yellow.
[ ] When we click on the Node buttons, if any nodes would overlap eachother, move the node to the right and down, hopefully creating a cascading effect so we have an idea of the number of windows. Do the same thing when we paste. 

## Image Nodes
[ ] Add a feature in the form of a button on the toolbar that allows us to import an image OR select from a library of icons (more later). This image should act as a NODE, having connection points, being resizeable, and rougly starting the image at about the same size as the Step node. The main difference is that there is no shape, it's just the image with a thin border. This will be helpful when we just want to point to icons of services. 
[ ] Add a feature that allows us to select from a calatog of architecture icons. I have downloaded the official SVG icons fro Azure and placed them here: /assets/Azure_Public_Service_Icons/Icons.
[ ] The image button should allow you to upload an image or select from a collection of SVGs. Allow the user to browse the folders to help find what they are looking for. Include a 'search' functionality so the user can start typing an immediately see results changing. 