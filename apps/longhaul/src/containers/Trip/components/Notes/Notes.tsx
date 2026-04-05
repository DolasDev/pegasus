import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useSelector } from 'react-redux'
import { Expandable } from '../../../../components/Expandable/Expandable'
import { Button as PegasusButton } from '../../../../components/Button'
import styles from './Notes.module.css'
import { API } from 'src/utils/api'
import logger from 'src/utils/logger'
import { startCase } from 'src/utils/string'

interface User {
  first_name: string
  last_name: string
  email_address: string
}

interface Note {
  id: string
  note: string
  createdByUser?: User
  createdAt: string
  updatedAt: string
}

interface NotesProps {
  tripId: string
  notes: Note[]
  reloadTrip(): void
}

// TODO fix this, not sure why forwarding react refs seem to be making the types fail
const Button = PegasusButton as any

enum NoteModalType {
  EDIT = 'EDIT',
  NEW = 'NEW',
}

type EditNoteProps = Pick<Note, 'id' | 'note'>

export const Notes: React.FC<NotesProps> = ({ notes, tripId, reloadTrip }) => {
  const [noteModalType, setNoteModalType] = useState<NoteModalType | null>(null)
  const [noteToEdit, setNoteToEdit] = useState<EditNoteProps | null>(null)
  const openNoteModal = () => {
    setNoteModalType(NoteModalType.NEW)
  }
  const editNote = (noteToEdit: EditNoteProps) => {
    setNoteModalType(NoteModalType.EDIT)
    setNoteToEdit(noteToEdit)
  }
  const closeNoteModal = () => {
    setNoteModalType(null)
    setNoteToEdit(null)
  }

  //console.log(noteToEdit, noteModalType, 'noteToEdit');

  const getName = (user: any) => {
    if (user?.first_name && user?.last_name) {
      return startCase(`${user?.first_name} ${user?.last_name}`.toLowerCase())
    } else {
      return user?.email_address
    }
  }

  return (
    <div className={styles.notesContainer}>
      <Expandable
        title={
          <>
            <span className={styles.noteTitle}>Notes ({notes.length})</span>
            <Button
              onClick={(e: any) => {
                e.stopPropagation()
                openNoteModal()
              }}
            >
              Add Note
            </Button>
          </>
        }
      >
        <div>
          {notes.map(({ id, note, createdAt, createdByUser, updatedAt }, i) => (
            <div className={styles.noteCard} key={i}>
              <p>{note}</p>
              <span className={styles.noteMeta}>
                {`-${getName(createdByUser)} : ${new Date(createdAt).toLocaleDateString()}
                   ${
                     new Date(updatedAt).toLocaleDateString !==
                     new Date(createdAt).toLocaleDateString
                       ? `Updated: ${new Date(updatedAt).toLocaleDateString()}`
                       : ''
                   }`}
              </span>
              <Button className={styles.editButton} onClick={() => editNote({ id, note })}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      </Expandable>
      {noteModalType ? (
        <NoteModal
          reloadTrip={reloadTrip}
          modalIsOpen={!!noteModalType}
          closeNoteModal={closeNoteModal}
          type={noteModalType}
          tripId={tripId}
          noteId={noteToEdit?.id}
          note={noteToEdit?.note}
        />
      ) : null}
    </div>
  )
}

interface NoteModalProps {
  modalIsOpen: boolean
  closeNoteModal(): void
  type: NoteModalType
  tripId: string
  note?: string
  noteId?: string
  reloadTrip(): void
}

const NoteModal: React.FC<NoteModalProps> = ({
  note = '',
  modalIsOpen,
  closeNoteModal,
  type,
  tripId,
  noteId,
  reloadTrip,
}) => {
  const [noteValue, setNote] = useState(note)
  const user = useSelector((state: any) => state.user.user)
  const saveNote = async () => {
    try {
      if (noteValue) {
        if (type === NoteModalType.NEW) {
          await API.createTripNote({
            tripId,
            createdBy: user.code,
            note: noteValue,
          })
        } else if (type === NoteModalType.EDIT && noteId) {
          await API.patchTripNote({
            tripId,
            id: noteId,
            note: noteValue,
          })
        }
      }
    } catch (e) {
      logger.error(e as Error, { message: 'error saving note' })
    } finally {
      reloadTrip()
      setNote('')
    }
    closeNoteModal()
  }

  return (
    <Dialog.Root open={modalIsOpen} onOpenChange={(open) => { if (!open) closeNoteModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1 }} />
        <Dialog.Content
          aria-describedby={undefined}
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '300px',
            height: '300px',
            zIndex: 50,
            backgroundColor: 'white',
            borderRadius: '4px',
            padding: '20px',
          }}
        >
          <Dialog.Title asChild>
            <h3>Add/Edit Note</h3>
          </Dialog.Title>
          <textarea
            value={noteValue}
            onChange={(e) => {
              setNote(e.target.value)
            }}
            className={styles.noteModalTextArea}
            name="note"
          />
          <div className={styles.noteModalButtonContainer}>
            <Dialog.Close asChild>
              <Button type="button" inverted color="rgb(172, 67, 67)">
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={saveNote} type="submit">
              Save Note
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
