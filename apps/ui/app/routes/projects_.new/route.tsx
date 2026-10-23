import { useState, useCallback } from 'react';
import type { MetaFunction } from 'react-router';
import { PageContent } from '#components/layout/page-content.js';
import { PageHeader } from '#components/layout/page-header.js';
import { useNavigate } from 'react-router';
import { Button } from '@taucad/ui/components/button';
import { Card, CardContent } from '@taucad/ui/components/card';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { WorkspaceSelector } from '#components/filesystem/workspace-selector.js';
import { getKernelOption } from '#utils/kernel.utils.js';
import { toast } from '#components/ui/sonner.js';
import { encodeTextFile } from '#utils/filesystem.utils.js';
import type { Handle } from '#types/matches.types.js';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { useProjectManager } from '#hooks/use-project-manager.js';
import { useProjectCreationLocation } from '#hooks/use-project-creation-location.js';
import { useProjectCreationLocationError } from '#hooks/use-project-creation-location-error.js';
import type { ProjectCreationLocation } from '#types/project-creation-location.types.js';
import { projectLocationDescriptor, projectLocationFullLabel } from '#utils/project-creation-location.utils.js';
import { projectUrl } from '#utils/project-url.utils.js';
import { isDesktopTarget } from '#lib/build-target.js';
import { sinopiaStarterKernelId } from '#lib/sinopia-engines.js';

const homeLocationLabel = projectLocationFullLabel(projectLocationDescriptor({ kind: 'home' }));

export const meta: MetaFunction = () => [{ title: 'New project · SinopiaCAD' }];

export const handle: Handle = {
  // Mobile: section scrolls as one page. Desktop: route uses h-full flex + inner list scroll (see layout).
  enableOverflowY: true,
};

// Custom hook for project creation logic
function useProjectCreation() {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const projectManager = useProjectManager();

  const createProject = useCallback(
    async (projectData: { name: string; description: string; location: ProjectCreationLocation }) => {
      setIsCreating(true);
      try {
        // SinopiaCAD: the empty starter file only; the chat pins no engine and the agent chooses one for the job.
        const selectedOption = getKernelOption(sinopiaStarterKernelId);

        const createProject = await projectManager.createProject({
          project: {
            name: projectData.name.trim(),
            description: projectData.description.trim(),
            tags: [],
            assets: {
              main: {
                entryPath: selectedOption.mainFile,
              },
            },
          },
          files: {
            [selectedOption.mainFile]: {
              content: encodeTextFile(selectedOption.emptyCode),
            },
          },
          chatName: 'Initial design',
          location: projectData.location,
          // SinopiaCAD: start on the model, with Misure and the agent beside it; never on the code.
          editorState: {
            panelState: {
              desktopLayout: { chatOpen: true, workbenchOpen: true, compactAuxiliary: 'chat' },
            },
          },
        });

        await navigate(projectUrl(createProject.slugs));
      } catch (error) {
        setIsCreating(false);
        console.error('Failed to create project:', error);
        throw error;
      }
    },
    [projectManager, navigate],
  );

  return { createProject, isCreating };
}

export default function ProjectsNew(): React.JSX.Element {
  const navigate = useNavigate();
  const { createProject, isCreating } = useProjectCreation();
  const location = useProjectCreationLocation();
  const presentLocationError = useProjectCreationLocationError();

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  const handleCreateProject = useCallback(async () => {
    if (location.phase !== 'ready') {
      return;
    }
    try {
      await createProject({
        name: projectName,
        description: projectDescription,
        location: location.value,
      });
    } catch (error) {
      if (presentLocationError(error)) {
        if (location.hasWebAccessCapability) {
          await location.refresh();
        }
        return;
      }
      toast.error('Failed to create project. Please try again.');
    }
  }, [createProject, location, presentLocationError, projectDescription, projectName]);

  const handleCancel = useCallback(() => {
    void navigate('/');
  }, [navigate]);

  const isCreateButtonDisabled = !projectName.trim() || isCreating || !location.canCreate;

  // Add keyboard shortcut for Enter to submit
  const { formattedKeyCombination } = useKeybinding(
    { key: 'Enter' },
    useCallback(() => {
      if (isCreateButtonDisabled) {
        toast.error('Please fill in all fields.');
      } else {
        void handleCreateProject();
      }
    }, [isCreateButtonDisabled, handleCreateProject]),
  );

  return (
    <PageContent layout='fill'>
      <PageHeader title='New project' />

      <div className='md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-hidden'>
        <Card className='flex flex-col bg-sidebar/70'>
          <CardContent className='shrink-0 space-y-4 py-6'>
            <div className='flex flex-col gap-4'>
              <div className='flex-1 space-y-2'>
                <Label htmlFor='project-name'>Project Name *</Label>
                <Input
                  autoFocus
                  autoComplete='off'
                  id='project-name'
                  value={projectName}
                  placeholder='Enter your project name…'
                  maxLength={100}
                  onChange={(event) => {
                    setProjectName(event.target.value);
                  }}
                />
              </div>
              <div className='flex-1 space-y-2'>
                <Label htmlFor='project-description'>Description (optional)</Label>
                <Input
                  id='project-description'
                  value={projectDescription}
                  placeholder="Describe what you're building…"
                  maxLength={500}
                  onChange={(event) => {
                    setProjectDescription(event.target.value);
                  }}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Location</Label>
              {location.shouldShowPicker ? (
                <WorkspaceSelector state={location} variant='field' />
              ) : (
                <p className='text-sm'>{homeLocationLabel}</p>
              )}
              {isDesktopTarget() ? undefined : (
                <p className='text-xs text-muted-foreground'>
                  Browser storage can be cleared or evicted. Export important work.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className='flex shrink-0 flex-col gap-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-between sm:gap-4'>
        <Button variant='outline' disabled={isCreating} onClick={handleCancel}>
          Cancel
        </Button>
        <Button disabled={isCreateButtonDisabled} className='min-w-30' onClick={handleCreateProject}>
          {isCreating ? 'Creating…' : `Create Project ${formattedKeyCombination}`}
        </Button>
      </div>
    </PageContent>
  );
}
