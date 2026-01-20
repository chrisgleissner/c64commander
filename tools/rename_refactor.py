import os

replacements = [
    # Paths first
    ('components/scoped/', 'components/itemSelection/'),
    ('lib/scopedBrowser/', 'lib/sourceNavigation/'),
    
    # Interfaces/Types
    ('ScopedBrowserDialogProps', 'ItemSelectionDialogProps'),
    ('ScopedBrowserViewProps', 'ItemSelectionViewProps'),
    ('ScopedSourceGroup', 'SourceGroup'),
    ('ScopedSelection', 'SelectedItem'),
    ('ScopedSource', 'SourceLocation'),
    ('ScopedEntry', 'SourceEntry'),
    
    # Components/Hooks
    ('ScopedBrowserDialog', 'ItemSelectionDialog'),
    ('ScopedBrowserView', 'ItemSelectionView'),
    ('useScopedBrowser', 'useSourceNavigator'),
    
    # Clean up any missed file references in imports
    ('/scopedBrowser', '/sourceNavigation'),
]

extensions = ('.ts', '.tsx', '.js', '.jsx')
search_paths = ['src', 'tests']

for root_path in search_paths:
    for root, dirs, files in os.walk(root_path):
        for file in files:
            if file.endswith(extensions):
                filepath = os.path.join(root, file)
                with open(filepath, 'r') as f:
                    content = f.read()
                
                new_content = content
                for old, new in replacements:
                    new_content = new_content.replace(old, new)
                
                if new_content != content:
                    print(f"Updating {filepath}")
                    with open(filepath, 'w') as f:
                        f.write(new_content)
