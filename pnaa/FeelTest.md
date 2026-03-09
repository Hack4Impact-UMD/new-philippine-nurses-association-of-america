1. Show/Hide archived should have a response if there is nothing archived.
    - in file event-list
    - good news: is showing the archived event when there is actually one 
    - remedy: When Hide/Show Archived is clicked, the button does switch, but should show a message if there is nothing archived for easier recognition

2. Inputting Amount Always has a 0 in the front when inputting campaign amount
    - in file Campaign-form
    - remedy: Although is showing the correct campaign amount inputted, can be confusing when inputting the amount. 

3. Login page design is ugly
    - in app, sign in, page.tsx
    - login page can be improved, the big ahh logo is not it
    - remedy: reformat the login box and PNAA logo to be more aesthetically pleasing, put the words 
    on the top right bigger and fit the page 

4. Sidebar words can be enlarged to fit entire sidebar
    - in dashboard, layout, sidebar.tsx 
    - remedy: the words can be enlarged and fit the whole sidebar, not just the top 1/3 

5. About page words do not fill the whole screen
    - couldnt find exact file but is in the About section in the sidebar.tsx
    - currently, there is a huge gap on the right side down to the bottom vertically, with the words not spreading across the whole screen
    - remedy: use flexbox to flex across the entire screen
