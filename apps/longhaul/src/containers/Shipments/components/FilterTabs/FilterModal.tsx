import React, { useEffect, useState } from 'react'
import Modal from 'react-modal'
import { useSelector, useDispatch } from 'react-redux'
import { Button } from '../../../../components/Button'
import { API } from 'src/utils/api'
import { changeShipmentQuery, deleteShipmentFilter } from 'src/redux/shipments'
import styles from './FilterModalStyles.module.css'
import { Snackbar } from '../../../../components/Snackbar'

Modal.setAppElement('#root')

const modalStyles = {
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    width: '500px',
    height: '500px',
    zIndex: 50,
    fontSize: '12px',
  },
  overlay: {
    zIndex: 1,
  },
}

interface FilterModalProps {
  modalIsOpen: boolean
  closeModal: () => void
}
const FilterModal: React.FC<FilterModalProps> = ({ modalIsOpen, closeModal }: FilterModalProps) => {
  const user = useSelector((state: any) => state.user.user)
  const dispatch = useDispatch<any>()
  const [selectedFilter, setSelectedFilter] = useState<any>()
  const [defaultFilter, setDefaultFilter] = useState()
  const [myFilters, setMyFilters] = useState()
  const [publicFilters, setPublicFilters] = useState()
  const [selectedTab, setSelectedTab] = useState(0)

  const [snackBarConfig, setShowSnackbar] = useState({
    show: false,
    message: '',
    type: '',
  })

  const loadMySavedFilters = async (type: any, code: any) => {
    const filters = await API.fetchSavedShipmentFilters({ type, userCode: code })
    setMyFilters(filters)
  }

  const loadDefaultFilter = async (userCode: any) => {
    try {
      const filter = await API.fetchShipmentDefaultFilterForUser(userCode)
      if (filter) {
        setDefaultFilter(filter)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    loadMySavedFilters('self', user.code)
    loadDefaultFilter(user.code)
  }, [user])

  useEffect(() => {
    const loadPublicSavedFilters = async (type: any, code: any) => {
      const filters = await API.fetchSavedShipmentFilters({ type, userCode: code })
      setPublicFilters(filters)
    }
    loadPublicSavedFilters('public', user.code)
  }, [user])

  const loadSelectedFilter = () => {
    dispatch(changeShipmentQuery(JSON.parse(selectedFilter?.query)))
    closeModal()
  }

  const deleteSelectedFilter = async () => {
    try {
      await dispatch(deleteShipmentFilter(selectedFilter?.id))
      console.log('Succesfully deleted filter')
      setShowSnackbar({
        show: true,
        message: 'Succesfully deleted filter',
        type: 'success',
      })
    } catch (e) {
      const err: any = e
      console.log(e)
      setShowSnackbar({
        show: true,
        message: err.message,
        type: 'error',
      })
    }
    loadMySavedFilters('self', user.code)
  }

  const setAsDefaultAndLoad = async () => {
    // Optimistically load the filter, don't await setting default
    API.setDefaultShipmentFilter(selectedFilter?.id).catch((e) =>
      console.error(`Error saving filter`, e),
    )
    loadSelectedFilter()
  }

  return (
    <Modal isOpen={modalIsOpen} style={modalStyles} contentLabel="Filters">
      <h2>Choose a Filter</h2>
      <div>
        <TabGroup
          setSelectedTabCallback={(number: number) => {
            setSelectedTab(number)
            setSelectedFilter(undefined)
          }}
          tabs={[
            {
              name: 'My Filters',
              Component: () => (
                <FilterList
                  listType="my-filters"
                  selectedFilter={selectedFilter}
                  list={myFilters}
                  setSelectedFilter={setSelectedFilter}
                  defaultFilter={defaultFilter}
                />
              ),
            },
            {
              name: 'All Filters',
              Component: () => (
                <FilterList
                  listType="all-filters"
                  selectedFilter={selectedFilter}
                  list={publicFilters}
                  setSelectedFilter={setSelectedFilter}
                  defaultFilter={defaultFilter}
                />
              ),
            },
          ]}
        />
      </div>
      <div style={{ position: 'absolute', bottom: '20px', right: '20px' }}>
        <Button
          type="button"
          onClick={closeModal}
          inverted
          color="rgb(172, 67, 67)"
          style={{ marginRight: '10px' }}
        >
          Close
        </Button>
        {selectedFilter ? (
          <>
            <Button
              type="button"
              onClick={setAsDefaultAndLoad}
              inverted
              color="rgb(172, 67, 67)"
              style={{ marginRight: '10px' }}
            >
              Use as Default
            </Button>
            <Button
              type="button"
              onClick={loadSelectedFilter}
              inverted
              color="rgb(172, 67, 67)"
              style={{ marginRight: '10px' }}
            >
              Load
            </Button>
            {selectedTab === 0 ? (
              <Button
                type="button"
                onClick={deleteSelectedFilter}
                inverted
                color="rgb(172, 67, 67)"
                style={{ marginRight: '10px' }}
              >
                Delete
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <Snackbar
        autoHideDuration={10 * 1000} // 10 seconds
        type={snackBarConfig.type}
        open={snackBarConfig.show}
        onClose={() => setShowSnackbar({ show: false, message: '', type: '' })}
        message={snackBarConfig.message}
      />
    </Modal>
  )
}

const FilterList = ({ listType, list, setSelectedFilter, selectedFilter, defaultFilter }: any) => {
  if (!list) {
    return null
  }
  return (
    <div key={listType} className={styles.filterList}>
      <div className={styles.filterListHeaders}>
        <div className={styles.nameColumn}>Filter Name</div>
        <div className={styles.createdByColumn}>Created By</div>
      </div>

      {list.map((savedFilter: any) => {
        const { name, owner, id } = savedFilter
        return (
          <div
            className={`${styles.filterCard} ${selectedFilter?.id === id ? styles.filterCardActive : ''} ${defaultFilter?.id === id ? styles.filterCardDefault : ''}`}
            onClick={() => setSelectedFilter(savedFilter)}
          >
            <div className={styles.nameColumn}>{name}</div>
            <div>
              {' '}
              {defaultFilter?.id === id ? <i className="fas fa-star"></i> : ''}{' '}
              {` ${owner?.first_name}`} {owner?.last_name}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface TabGroupProps {
  tabs: any[]
  setSelectedTabCallback: (tabIndex: number) => void
}

const TabGroup: React.FC<TabGroupProps> = ({ tabs, setSelectedTabCallback }: TabGroupProps) => {
  const [selectedTab, setSelectedTab] = useState(0)

  const SelectedBody = tabs[selectedTab]?.Component
  return (
    <div className={styles.tabGroup}>
      <div className={styles.tabContainer}>
        {tabs.map((tab, tabIndex) => (
          <div
            onClick={() => {
              if (setSelectedTabCallback) setSelectedTabCallback(tabIndex)
              setSelectedTab(tabIndex)
            }}
            key={tab.name}
            className={`${styles.tab} ${tabIndex === selectedTab ? styles.selectedTab : ''}`}
          >
            {tab.name}
          </div>
        ))}
      </div>
      <div className={styles.tabGroupBody}>{!!SelectedBody && <SelectedBody />}</div>
    </div>
  )
}

export default FilterModal
