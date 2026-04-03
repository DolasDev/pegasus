import React, { useState } from 'react'
import Modal from 'react-modal'
import { useSelector } from 'react-redux'
import { InputField } from 'src/components/InputField'
import { Button } from '../../../../components/Button'
import { API } from 'src/utils/api'
import styles from './SaveFilterModalStyles.module.css'

Modal.setAppElement('#root')

const modalStyles = {
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    width: '400px',
    height: '300px',
    zIndex: 50,
    fontSize: '12px',
  },
  overlay: {
    zIndex: 1,
  },
}

// string, number, boolean, date, array, object

interface SaveFilterModalProps {
  modalIsOpen: boolean
  closeModal: () => void
}
const SaveFilterModal: React.FC<SaveFilterModalProps> = ({
  modalIsOpen,
  closeModal,
}: SaveFilterModalProps) => {
  const [filterName, setFilterName] = useState()
  const [isDefault, setIsDefault] = useState(false)
  const [isPublic, setIsPublic] = useState(false)

  const user = useSelector((state: any) => state.user.user)
  const currentQuery = useSelector((state: any) => state.shipments.query)

  const saveFilter = async () => {
    const payload = {
      name: filterName,
      is_default: isDefault,
      is_public: isPublic,
      user_code: user.code,
      query: currentQuery,
    }

    await API.saveShipmentsFilter(payload)

    closeModal()
  }

  return (
    <Modal isOpen={modalIsOpen} style={modalStyles} contentLabel="Save Filter">
      <h2>Save Filter</h2>
      <div>
        <label>Filter Name</label>
        <InputField
          limit={100}
          placeholder="Enter name"
          onChange={(e: any) => {
            setFilterName(e.target.value)
          }}
          value={filterName}
        />
        <div className={styles['checkbox-container']}>
          <label>Make Default</label>
          <input
            onChange={(e) => {
              setIsDefault(e.target.checked)
            }}
            type="checkbox"
          />
          <label>Make Public</label>
          <input
            onChange={(e) => {
              setIsPublic(e.target.checked)
            }}
            type="checkbox"
          />
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: '20px', right: '20px' }}>
        <Button
          type="button"
          onClick={closeModal}
          inverted
          color="rgb(172, 67, 67)"
          style={{ marginRight: '10px' }}
        >
          Cancel
        </Button>
        <Button onClick={saveFilter} type="submit">
          Save Filter
        </Button>
      </div>
    </Modal>
  )
}

export default SaveFilterModal
